import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeEstimate } from "@/lib/pricing/canadaPricingEngine";

async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: key });
}

const ESTIMATE_WIZARD_PROMPT = `You generate a short estimate refinement wizard for contractors.

Given project + scope context, return 4-6 concise questions that improve estimate quality.
Prioritize questions affecting quantity, material cost, labor intensity, and overlap clarity.

Return ONLY JSON:
[
  { "id": "string_snake_case", "question": "string", "placeholder": "string" }
]`;

type EstimateOverride = {
  quantity?: number;
  materialUnitCost?: number;
  laborHours?: number;
  materialName?: string;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId ?? req.nextUrl.searchParams.get("projectId");
  const mode = typeof body.mode === "string" ? body.mode : "generate";
  const estimatePrompt = typeof body.estimatePrompt === "string" ? body.estimatePrompt.trim() : "";
  const refinementAnswers: Record<string, string> =
    body.refinementAnswers && typeof body.refinementAnswers === "object"
      ? body.refinementAnswers
      : {};
  const overrides: Record<string, EstimateOverride> =
    body.overrides && typeof body.overrides === "object"
      ? body.overrides
      : {};

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const [project, userPricing] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      include: { scopes: { include: { items: true } } },
    }),
    prisma.userPricing.findMany({ where: { userId: session.user.id } }),
  ]);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const allScopeItems = project.scopes.flatMap((s) => s.items);
  if (allScopeItems.length === 0) {
    return NextResponse.json(
      { error: "Add scope items first" },
      { status: 400 }
    );
  }

  if (mode === "questions") {
    const scopeSummary = allScopeItems
      .map((i) => `${i.segment}: ${i.task} | ${i.quantity} ${i.unit} | ${i.material} | ${i.laborHours ?? 0}h`)
      .join("\n");
    const wizardContext = [
      `Address: ${project.address}, ${project.province}`,
      `Sqft: ${project.sqft}`,
      `Job description: ${project.jobPrompt ?? "not provided"}`,
      `Notes: ${project.notes ?? "none"}`,
      `Scope:\n${scopeSummary}`,
    ].join("\n\n");

    const openai = await getOpenAI();
    const qRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: ESTIMATE_WIZARD_PROMPT },
        { role: "user", content: wizardContext },
      ],
      max_tokens: 450,
    });
    const qText = qRes.choices[0]?.message?.content ?? "[]";
    let questions: Array<{ id: string; question: string; placeholder?: string }> = [];
    try {
      const parsed = JSON.parse(qText.replace(/```json\n?|\n?```/g, "").trim()) as unknown;
      if (Array.isArray(parsed)) {
        questions = parsed
          .map((q) => {
            const obj = q as Record<string, unknown>;
            return {
              id: String(obj.id ?? "").trim(),
              question: String(obj.question ?? "").trim(),
              placeholder: String(obj.placeholder ?? "").trim() || undefined,
            };
          })
          .filter((q) => q.id && q.question)
          .slice(0, 6);
      }
    } catch {
      questions = [];
    }
    return NextResponse.json({ questions });
  }

  const pricingMap = Object.fromEntries(
    userPricing.map((p) => [p.key, { rate: p.rate, unit: p.unit }])
  );
  const result = computeEstimate(project.province, allScopeItems, pricingMap);

  const scopeById = new Map(allScopeItems.map((s) => [s.id, s]));
  const lineWarnings: string[] = [];
  const overlapWarnings = new Set<string>();

  const adjustedLines = result.lines.map((line) => {
    const override = overrides[line.scopeItemId] ?? {};
    const scopeItem = scopeById.get(line.scopeItemId);
    let quantity = line.quantity;
    let laborHours = line.laborHours;
    let materialUnitCost = line.materialUnitCost;
    let materialName = line.materialName;
    let pricingSource = line.pricingSource;

    if (typeof override.quantity === "number" && Number.isFinite(override.quantity) && override.quantity > 0) {
      quantity = override.quantity;
      if (quantity !== line.quantity) pricingSource = "user";
    }
    if (typeof override.laborHours === "number" && Number.isFinite(override.laborHours) && override.laborHours >= 0) {
      laborHours = override.laborHours;
      if (laborHours !== line.laborHours) pricingSource = "user";
    }
    if (typeof override.materialUnitCost === "number" && Number.isFinite(override.materialUnitCost) && override.materialUnitCost > 0) {
      materialUnitCost = override.materialUnitCost;
      pricingSource = "user";
    }
    if (typeof override.materialName === "string" && override.materialName.trim()) {
      materialName = override.materialName.trim();
    }

    const laborCost = (laborHours ?? 0) * line.laborRate;
    const materialCost = quantity * materialUnitCost;
    const subtotal = laborCost + materialCost;
    const markup = subtotal * 0.15;
    const tax = (subtotal + markup) * ((result.assumptions.taxRate ?? 0));

    const taskLower = `${line.segment} ${line.task}`.toLowerCase();
    if (
      (taskLower.includes("kitchen") || taskLower.includes("bathroom") || taskLower.includes("plumbing") || taskLower.includes("electrical")) &&
      materialCost < 150
    ) {
      lineWarnings.push(`Low material cost detected for "${line.task}" - review quantity/unit cost.`);
    }
    if (
      scopeItem &&
      /renovat|full|complete/i.test(scopeItem.task) &&
      /kitchen|bathroom|basement|whole/i.test(scopeItem.segment) &&
      /each|house|set/.test(line.unit.toLowerCase())
    ) {
      lineWarnings.push(`Package "${line.task}" may be under-quantified (${line.quantity} ${line.unit}).`);
    }

    return {
      ...line,
      quantity,
      laborHours,
      materialUnitCost,
      materialName,
      pricingSource,
      laborCost,
      materialCost,
      subtotal,
      markup,
      tax,
      total: subtotal + markup + tax,
    };
  });

  for (let i = 0; i < adjustedLines.length; i++) {
    for (let j = i + 1; j < adjustedLines.length; j++) {
      const a = adjustedLines[i];
      const b = adjustedLines[j];
      const aSeg = a.segment.toLowerCase();
      const bSeg = b.segment.toLowerCase();
      const sameArea = aSeg === bSeg || aSeg.includes(bSeg) || bSeg.includes(aSeg);
      if (!sameArea) continue;
      const aTask = a.task.toLowerCase();
      const bTask = b.task.toLowerCase();
      if (
        (aTask.includes("bathroom renovation") && bTask.includes("tile")) ||
        (bTask.includes("bathroom renovation") && aTask.includes("tile")) ||
        (aTask.includes("kitchen renovation") && bTask.includes("cabinet")) ||
        (bTask.includes("kitchen renovation") && aTask.includes("cabinet"))
      ) {
        overlapWarnings.add(`Possible overlap in ${a.segment}: "${a.task}" and "${b.task}".`);
      }
    }
  }

  const totalLabor = adjustedLines.reduce((s, l) => s + l.laborCost, 0);
  const totalMaterial = adjustedLines.reduce((s, l) => s + l.materialCost, 0);
  const markup = adjustedLines.reduce((s, l) => s + l.markup, 0);
  const tax = adjustedLines.reduce((s, l) => s + l.tax, 0);
  const grandTotal = totalLabor + totalMaterial + markup + tax;

  // Create or replace draft estimate (never touch sealed)
  const existing = await prisma.estimate.findFirst({
    where: { projectId, status: "draft" },
    include: { lines: true },
  });

  if (existing) {
    await prisma.estimateLine.deleteMany({ where: { estimateId: existing.id } });
    await prisma.estimate.delete({ where: { id: existing.id } });
  }
  // If no existing draft, we create new. Sealed estimates are left intact.

  const estimate = await prisma.estimate.create({
    data: {
      projectId,
      status: "draft",
      totalLabor,
      totalMaterial,
      totalMarkup: markup,
      totalTax: tax,
      grandTotal,
      assumptions: {
        ...(result.assumptions as object),
        estimatePrompt: estimatePrompt || undefined,
        refinementAnswers,
        lineWarnings: Array.from(new Set([...lineWarnings, ...overlapWarnings])),
      },
    },
  });

  for (const line of adjustedLines) {
    await prisma.estimateLine.create({
      data: {
        estimateId: estimate.id,
        scopeItemId: line.scopeItemId,
        laborCost: line.laborCost,
        materialCost: line.materialCost,
        markup: line.markup,
        tax: line.tax,
        laborHours: line.laborHours,
        laborRate: line.laborRate,
        materialUnitCost: line.materialUnitCost,
        quantity: line.quantity,
        unit: line.unit,
        materialName: line.materialName,
        pricingSource: line.pricingSource,
      },
    });
  }

  const full = await prisma.estimate.findUnique({
    where: { id: estimate.id },
    include: { lines: { include: { scopeItem: true } } },
  });

  return NextResponse.json({
    estimate: full,
    breakdown: {
      ...result,
      lines: adjustedLines,
      totalLabor,
      totalMaterial,
      markup,
      tax,
      grandTotal,
      warnings: Array.from(new Set([...lineWarnings, ...overlapWarnings])),
    },
  });
}
