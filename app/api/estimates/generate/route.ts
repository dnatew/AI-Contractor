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
Generate a NEXT-PASS trivia set: ask for new useful details, not repeats.
Do not ask for labor/material rates already captured in user pricing settings.
Do not repeat already-answered questions.

Return ONLY JSON:
[
  {
    "id": "string_snake_case",
    "question": "string",
    "emoji": "single_emoji",
    "type": "multiple_choice" | "text",
    "options": [
      { "id": "option_id", "label": "string", "emoji": "single_emoji" }
    ],
    "placeholder": "string"
  }
]`;

type EstimateOverride = {
  quantity?: number;
  materialUnitCost?: number;
  laborHours?: number;
  materialName?: string;
};

const MARKUP_PERCENT = 0.15;

type AiEstimateLine = {
  scopeItemId: string;
  quantity?: number;
  unit?: string;
  laborHours?: number;
  laborRate?: number;
  materialUnitCost?: number;
  materialName?: string;
  pricingSource?: "user" | "default";
  notes?: string;
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

  const [project, userPricing, latestEstimate] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      include: { scopes: { include: { items: true } } },
    }),
    prisma.userPricing.findMany({ where: { userId: session.user.id } }),
    prisma.estimate.findFirst({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { assumptions: true },
    }),
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
    const previousAssumptions =
      (latestEstimate?.assumptions as {
        refinementAnswers?: Record<string, string>;
        estimatePrompt?: string;
      } | null) ?? null;
    const priorAnswers = {
      ...(previousAssumptions?.refinementAnswers ?? {}),
      ...refinementAnswers,
    };

    const userPricingHints = userPricing
      .map((p) => `${p.key}:${p.rate}/${p.unit}`)
      .join(", ");
    const scopeSummary = allScopeItems
      .map((i) => `${i.segment}: ${i.task} | ${i.quantity} ${i.unit} | ${i.material} | ${i.laborHours ?? 0}h`)
      .join("\n");
    const wizardContext = [
      `Address: ${project.address}, ${project.province}`,
      `Sqft: ${project.sqft}`,
      `Job description: ${project.jobPrompt ?? "not provided"}`,
      `Notes: ${project.notes ?? "none"}`,
      `User pricing settings (already known): ${userPricingHints || "none"}`,
      `Previous estimate prompt: ${(previousAssumptions?.estimatePrompt ?? estimatePrompt) || "none"}`,
      `Already answered refinement inputs:\n${
        Object.entries(priorAnswers).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- none"
      }`,
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
            const optionsRaw = Array.isArray(obj.options) ? obj.options : [];
            const options = optionsRaw
              .map((o) => o as Record<string, unknown>)
              .map((o) => ({
                id: String(o.id ?? "").trim(),
                label: String(o.label ?? "").trim(),
                emoji: String(o.emoji ?? "").trim() || undefined,
              }))
              .filter((o) => o.id && o.label)
              .slice(0, 6);
            return {
              id: String(obj.id ?? "").trim(),
              question: String(obj.question ?? "").trim(),
              emoji: String(obj.emoji ?? "").trim() || undefined,
              type: obj.type === "text" ? "text" : "multiple_choice",
              options: options.length > 1 ? options : undefined,
              placeholder: String(obj.placeholder ?? "").trim() || undefined,
            };
          })
          .filter((q) => q.id && q.question)
          .filter((q) => !(priorAnswers[q.id]?.trim()))
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
  const baselineResult = computeEstimate(project.province, allScopeItems, pricingMap);
  let usedAiPricing = false;

  const pricingHints = userPricing
    .map((p) => `- ${p.key}: ${p.rate}/${p.unit}`)
    .join("\n");
  const scopeForAi = allScopeItems
    .map((i) => `- id=${i.id} | ${i.segment}: ${i.task} | ${i.quantity} ${i.unit} | material=${i.material} | laborHoursHint=${i.laborHours ?? 0}`)
    .join("\n");
  const refinementForAi = Object.entries(refinementAnswers)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let aiLines: AiEstimateLine[] = [];
  try {
    const openai = await getOpenAI();
    const aiRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a Canadian renovation estimator. Produce realistic labor/material rates per scope line. Use specific trade reasoning, avoid placeholder micro-costs, and output only valid JSON.",
        },
        {
          role: "user",
          content: `Project: ${project.address}, ${project.province}, ${project.sqft} sqft
Job description: ${project.jobPrompt ?? "not provided"}
Extra estimate prompt: ${estimatePrompt || "none"}
Refinement answers:
${refinementForAi || "- none"}

User pricing hints:
${pricingHints || "- none"}

Scope lines:
${scopeForAi}

Return JSON array with one item per scope line:
[
  {
    "scopeItemId": string,
    "quantity": number,
    "unit": string,
    "laborHours": number,
    "laborRate": number,
    "materialUnitCost": number,
    "materialName": string,
    "pricingSource": "user" | "default",
    "notes": string
  }
]
Rules:
- Keep quantity/unit aligned with scope intent.
- Labor/material must be plausible for MB/Canada.
- Do not use token placeholder values like 4.95 for full package lines unless truly justified.
- If user pricing hints directly match a line, set pricingSource to "user".`,
        },
      ],
      max_tokens: 1800,
    });
    const aiText = aiRes.choices[0]?.message?.content ?? "[]";
    const parsed = JSON.parse(aiText.replace(/```json\n?|\n?```/g, "").trim()) as unknown;
    if (Array.isArray(parsed)) {
      aiLines = parsed
        .map((x) => x as Record<string, unknown>)
        .map((x) => ({
          scopeItemId: String(x.scopeItemId ?? ""),
          quantity: typeof x.quantity === "number" ? x.quantity : undefined,
          unit: typeof x.unit === "string" ? x.unit : undefined,
          laborHours: typeof x.laborHours === "number" ? x.laborHours : undefined,
          laborRate: typeof x.laborRate === "number" ? x.laborRate : undefined,
          materialUnitCost: typeof x.materialUnitCost === "number" ? x.materialUnitCost : undefined,
          materialName: typeof x.materialName === "string" ? x.materialName : undefined,
          pricingSource: (x.pricingSource === "user" ? "user" : "default") as "user" | "default",
          notes: typeof x.notes === "string" ? x.notes : undefined,
        }))
        .filter((x) => x.scopeItemId);
      usedAiPricing = aiLines.length > 0;
    }
  } catch {
    usedAiPricing = false;
  }

  const aiById = new Map(aiLines.map((l) => [l.scopeItemId, l]));

  const scopeById = new Map(allScopeItems.map((s) => [s.id, s]));
  const lineWarnings: string[] = [];
  const overlapWarnings = new Set<string>();
  const baseLines = baselineResult.lines.map((line) => {
    const aiLine = aiById.get(line.scopeItemId);
    const quantity = aiLine?.quantity && aiLine.quantity > 0 ? aiLine.quantity : line.quantity;
    const unit = aiLine?.unit?.trim() ? aiLine.unit.trim() : line.unit;
    const laborHours = aiLine?.laborHours != null && aiLine.laborHours >= 0 ? aiLine.laborHours : line.laborHours;
    const laborRate = aiLine?.laborRate != null && aiLine.laborRate > 0 ? aiLine.laborRate : line.laborRate;
    const materialUnitCost = aiLine?.materialUnitCost != null && aiLine.materialUnitCost > 0 ? aiLine.materialUnitCost : line.materialUnitCost;
    const materialName = aiLine?.materialName?.trim() ? aiLine.materialName.trim() : line.materialName;
    const pricingSource = aiLine?.pricingSource ?? line.pricingSource;
    const laborCost = (laborHours ?? 0) * laborRate;
    const materialCost = quantity * materialUnitCost;
    const subtotal = laborCost + materialCost;
    const markup = subtotal * MARKUP_PERCENT;
    const tax = (subtotal + markup) * (baselineResult.assumptions.taxRate ?? 0);
    return {
      ...line,
      quantity,
      unit,
      laborHours,
      laborRate,
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

  const adjustedLines = baseLines.map((line) => {
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
    const markup = subtotal * MARKUP_PERCENT;
    const tax = (subtotal + markup) * ((baselineResult.assumptions.taxRate ?? 0));

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
        ...(baselineResult.assumptions as object),
        estimatorMode: usedAiPricing ? "ai_primary" : "fallback_engine",
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
      ...baselineResult,
      lines: adjustedLines,
      totalLabor,
      totalMaterial,
      markup,
      tax,
      grandTotal,
      estimatorMode: usedAiPricing ? "ai_primary" : "fallback_engine",
      warnings: Array.from(new Set([...lineWarnings, ...overlapWarnings])),
    },
  });
}
