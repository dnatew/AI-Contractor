import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: key });
}

const DESCRIPTION_SCOPE_PROMPT = `You are a Canadian renovation scope estimator.

Build concise but complete work packages from:
- job description (primary)
- selected work types and rooms
- material grade
- notes and photo notes

Output style:
- practical estimating packages
- clear area names
- realistic quantity, unit, labor hours
- include prep/demo/install/finish effort where relevant

Coverage:
- include all selected work types somewhere in the final scope
- if description implies additional critical work, include it

Adaptive item count:
- simple projects: 7-8 items
- complex/full interior projects: 10-12 items

Refinement mode:
- if current scope + refinement instruction is provided, apply refinement first
- keep unaffected intent intact

Return ONLY JSON array:
[
  {
    "segment": string,
    "task": string,
    "material": string,
    "quantity": number,
    "unit": string,
    "laborHours": number
  }
]`;

const REFINEMENT_WIZARD_PROMPT = `You generate a short scope-refinement wizard for contractors.

Given broad project context, return 5-6 concise questions that improve scope accuracy.
Ask only high-impact questions (coverage, quantities, major systems, areas).

Return ONLY JSON:
[
  { "id": "string_snake_case", "question": "string", "placeholder": "string" }
]`;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId;
  const tweakPrompt = typeof body.tweakPrompt === "string" ? body.tweakPrompt.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode : "generate";
  const refinementAnswers: Record<string, string> =
    body.refinementAnswers && typeof body.refinementAnswers === "object"
      ? body.refinementAnswers
      : {};

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    include: {
      photos: true,
      scopes: { include: { items: true } },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const existingItems = project.scopes.flatMap((s) => s.items);
  const isRefinement = tweakPrompt.length > 0 && existingItems.length > 0;

  if (tweakPrompt) {
    const currentDesc = project.jobPrompt ?? "";
    const updatedDesc = currentDesc
      ? `${currentDesc}\n\nUpdate: ${tweakPrompt}`
      : tweakPrompt;
    await prisma.project.update({
      where: { id: projectId },
      data: { jobPrompt: updatedDesc },
    });
    project.jobPrompt = updatedDesc;
  }

  const WORK_TYPE_LABELS: Record<string, string> = {
    flooring: "Flooring", kitchen: "Kitchen renovation", bathroom: "Bathroom renovation",
    painting: "Painting", drywall: "Drywall", tiling: "Tiling",
    baseboard_trim: "Baseboard & Trim", demolition: "Demolition",
    plumbing: "Plumbing", electrical: "Electrical", other: "Other",
  };

  const workTypeList = project.workTypes?.split(",").filter(Boolean) ?? [];
  const workTypeLabels = workTypeList.map(w => WORK_TYPE_LABELS[w] ?? w.replace(/_/g, " "));
  const roomList = project.rooms?.split(",").filter(Boolean).map((r: string) => r.replace(/_/g, " ")) ?? [];
  const grade = project.materialGrade?.replace(/_/g, " ") ?? "mid range";
  const hasWholeHouseOnly =
    roomList.length === 1 && roomList[0].toLowerCase().replace(/\s+/g, "_") === "whole_house";
  const isComplex =
    workTypeList.length >= 6 ||
    hasWholeHouseOnly ||
    /full\s*(interior|house)|whole\s*house|gut|complete\s*reno|complete\s*interior/i.test(project.jobPrompt ?? "");
  const targetRange = isComplex ? "10-12" : "7-8";

  if (mode === "questions") {
    const wizardContext = [
      `Address: ${project.address}, ${project.province}`,
      `Sqft: ${project.sqft}`,
      `Work types: ${workTypeLabels.join(", ") || "not provided"}`,
      `Rooms: ${roomList.join(", ") || "not provided"}`,
      `Material grade: ${grade}`,
      `Job description: ${project.jobPrompt ?? "not provided"}`,
      `Notes: ${project.notes ?? "none"}`,
      `Photo notes: ${
        project.photos
          .filter((p) => p.roomLabel || p.userNotes)
          .map((p) => [p.roomLabel, p.userNotes].filter(Boolean).join(" - "))
          .join(" | ") || "none"
      }`,
    ].join("\n");

    const openai = await getOpenAI();
    const qRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: REFINEMENT_WIZARD_PROMPT },
        { role: "user", content: wizardContext },
      ],
      max_tokens: 500,
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

    return NextResponse.json({
      questions,
      needsRefinement: questions.length > 0,
      recommendedItemRange: targetRange,
    });
  }

  const contextParts: string[] = [];
  contextParts.push("=== PROJECT DETAILS ===");
  contextParts.push(`Address: ${project.address}, ${project.province}`);
  contextParts.push(`Total square footage: ${project.sqft} sqft`);
  if (project.propertyType) contextParts.push(`Property type: ${project.propertyType}`);
  if (project.neighborhoodTier) contextParts.push(`Neighborhood tier: ${project.neighborhoodTier.replace(/_/g, " ")}`);

  contextParts.push("\n=== CONTRACTOR SELECTIONS (use these to build the scope) ===");
  if (workTypeLabels.length > 0) {
    contextParts.push(`Work types selected (${workTypeLabels.length}):`);
    for (const label of workTypeLabels) {
      contextParts.push(`  • ${label}`);
    }
    contextParts.push(`Coverage target: include all selected work types somewhere in the final scope.`);
  }
  if (roomList.length > 0) {
    contextParts.push(`Rooms selected (${roomList.length}):`);
    for (const room of roomList) {
      contextParts.push(`  • ${room}`);
    }
    contextParts.push(`Use room/area segments that are clear to estimate from.`);
  }
  contextParts.push(`Material grade: ${grade}`);
  contextParts.push(`Target scope size: ${targetRange} items (adaptive by complexity).`);

  if (project.jobPrompt) {
    contextParts.push(`\n=== JOB DESCRIPTION ===\n${project.jobPrompt}`);
  }
  if (project.notes) {
    contextParts.push(`\n=== ADDITIONAL NOTES ===\n${project.notes}`);
  }

  if (isRefinement) {
    const scopeSnapshot = existingItems.map((item) =>
      `- [${item.segment}] ${item.task} | ${item.material} | ${item.quantity} ${item.unit} | ${item.laborHours}h`
    ).join("\n");
    contextParts.push(`\n=== CURRENT SCOPE (you already generated this — now REFINE it) ===\n${scopeSnapshot}`);
    contextParts.push(`\n=== REFINEMENT INSTRUCTION (HIGHEST PRIORITY — follow this exactly) ===\n${tweakPrompt}`);
    contextParts.push(`→ The contractor has already seen the scope above and is now asking for a specific change.`);
    contextParts.push(`→ Apply the refinement instruction while keeping everything else intact.`);
    contextParts.push(`→ If the instruction says to "break apart" or "separate" items, split them into individual items.`);
    contextParts.push(`→ If the instruction says to "add" something, add it without removing existing items.`);
    contextParts.push(`→ Keep final scope in the adaptive target range (${targetRange}).`);
  } else if (tweakPrompt) {
    contextParts.push(`\n=== ADDITIONAL INSTRUCTION ===\n${tweakPrompt}`);
  }

  const answered = Object.entries(refinementAnswers)
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => `- ${k}: ${v.trim()}`);
  if (answered.length > 0) {
    contextParts.push(`\n=== REFINEMENT Q&A ===\n${answered.join("\n")}`);
  }

  const photoNotes = project.photos
    .filter((p) => p.roomLabel || p.userNotes)
    .map((p) => {
      const parts = [];
      if (p.roomLabel) parts.push(`Room: ${p.roomLabel}`);
      if (p.userNotes) parts.push(`Notes: ${p.userNotes}`);
      return parts.join(" - ");
    });

  if (photoNotes.length > 0) {
    contextParts.push(`\nPhoto notes from contractor:\n${photoNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`);
  }

  const userMessage = contextParts.join("\n");

  const openai = await getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: DESCRIPTION_SCOPE_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: 2000,
  });

  const text = res.choices[0]?.message?.content ?? "[]";
  let scopeItems: unknown[];
  try {
    scopeItems = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
  } catch {
    return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
  }

  if (!Array.isArray(scopeItems)) {
    return NextResponse.json({ error: "Invalid scope response" }, { status: 500 });
  }

  let mainScope = await prisma.scope.findFirst({
    where: { projectId, name: "Main" },
  });
  if (!mainScope) {
    mainScope = await prisma.scope.create({
      data: { projectId, name: "Main", description: "Generated from job description", order: 0 },
    });
  }

  await prisma.scopeItem.deleteMany({ where: { scopeId: mainScope.id } });

  for (const item of scopeItems) {
    const i = item as Record<string, unknown>;
    await prisma.scopeItem.create({
      data: {
        scopeId: mainScope.id,
        segment: String(i.segment ?? "General"),
        task: String(i.task ?? ""),
        material: String(i.material ?? ""),
        quantity: typeof i.quantity === "number" ? i.quantity : 0,
        unit: String(i.unit ?? "sqft"),
        laborHours: typeof i.laborHours === "number" ? i.laborHours : 0,
        source: "AI",
      },
    });
  }

  const scope = await prisma.scope.findUnique({
    where: { id: mainScope.id },
    include: { items: true },
  });

  return NextResponse.json({ scope, itemCount: scopeItems.length });
}
