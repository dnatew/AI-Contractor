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

const DESCRIPTION_SCOPE_PROMPT = `You are a Canadian construction/renovation scope estimator.

Given a project description with property details, work types, rooms, material grade, and contractor notes, generate a comprehensive work scope.

REFINEMENT MODE:
If you receive a CURRENT SCOPE with a REFINEMENT INSTRUCTION:
- The contractor has already reviewed the scope and wants a targeted change.
- The REFINEMENT INSTRUCTION is your HIGHEST PRIORITY — follow it exactly.
- Keep all other items from the current scope intact (same quantities, hours, materials).
- Only modify what the refinement asks for.

HOW TO BUILD THE SCOPE:
The contractor has selected WORK TYPES and ROOMS. You must cross-reference them:
- If they selected work types [painting, tiling, baseboard_trim] and rooms [Kitchen, Bathroom, Living Room]:
  → You need items covering painting in those rooms, tiling where relevant, and trim where relevant.
  → NOT just one type of work repeated across rooms.
- Think of it as a matrix: WORK TYPES × ROOMS. Every selected work type must appear. Every selected room must appear.
- You can combine multiple work types into one item per room when logical (e.g. "Kitchen — paint walls, install backsplash tile, replace baseboard trim").
- Or you can have separate items per work type if they are large enough to warrant it.
- DO NOT default to flooring-only. Only include flooring if the contractor selected it as a work type.

CRITICAL RULES:
1. Return 6 to 8 scope items total.
2. Each item is a complete work package — include demo, prep, install, and finishing in the description.
3. EVERY selected work type MUST be represented in at least one item.
4. EVERY selected room MUST appear as a segment in at least one item.
5. The JOB DESCRIPTION is written by the contractor and is a PRIMARY input — treat it as specific instructions.
   - If it says "rip out old kitchen cabinets and install new ones", that overrides generic assumptions.
   - If it mentions specific materials, brands, or methods, use those in the scope items.
   - If it describes work not covered by the selected work types, STILL include it.
   - The description tells you exactly what the contractor wants — reflect it faithfully.
6. Include realistic labor hours covering all sub-tasks (demo + prep + install + finishing + cleanup).
7. Quantity should be realistic for the work described (sqft for surfaces, linear ft for trim, "each" for fixtures).
8. Material names should reflect the selected material grade (budget = basic/builder, mid_range = standard, premium = high-end) unless the description specifies otherwise.

EXAMPLES of good work-type coverage:
- Painting selected → "Kitchen — scrape, prime and paint walls and ceiling (2 coats), touch-up trim"
- Tiling selected → "Bathroom — remove old tile, prep substrate, install ceramic tile on floor and shower walls"
- Drywall selected → "Basement — hang and finish drywall on framed walls, tape, mud, sand to level 4"
- Baseboard/trim selected → "Living Room — remove old baseboards, install new MDF baseboard and door casing"
- Kitchen reno selected → "Kitchen — demolish old cabinets, install new shaker cabinets, countertop, hardware"
- Plumbing selected → "Bathroom — replace faucet, install new toilet, connect vanity plumbing"
- Electrical selected → "Kitchen — install 4 pot lights, add under-cabinet LED strips, replace switches/outlets"

Return a JSON array of scope items. Each item:
- segment: string (room or area, e.g. "Kitchen", "Bathroom", "Living Room")
- task: string (complete work package — be specific about what's included)
- material: string (primary material with grade appropriate to selection)
- quantity: number (realistic quantity for the work)
- unit: string ("sqft", "linear ft", "each", etc.)
- laborHours: number (total hours for the full work package)

Return ONLY a valid JSON array, no markdown or explanation.`;

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
    contextParts.push(`→ EVERY work type listed above MUST appear in at least one scope item. Do NOT focus on just one type.`);
  }
  if (roomList.length > 0) {
    contextParts.push(`Rooms selected (${roomList.length}):`);
    for (const room of roomList) {
      contextParts.push(`  • ${room}`);
    }
    contextParts.push(`→ Use these rooms as "segment" values. Each room needs at least one scope item.`);
  }
  contextParts.push(`Material grade: ${grade}`);
  contextParts.push(`→ Use ${grade} materials in all material names.`);

  if (workTypeLabels.length > 0 && roomList.length > 0) {
    contextParts.push(`\n→ CHECKLIST: Your scope must cover: ${workTypeLabels.join(", ")} across ${roomList.join(", ")}. If a work type doesn't apply to a specific room, skip that combination, but every work type must appear somewhere.`);
  }

  if (project.jobPrompt) {
    contextParts.push(`\n=== JOB DESCRIPTION (written by the contractor — this is a primary input, follow it closely) ===\n${project.jobPrompt}`);
    contextParts.push(`→ The above description tells you EXACTLY what the contractor wants done. Build scope items that match it.`);
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
    contextParts.push(`→ Still respect the 6-8 item limit — consolidate elsewhere if needed.`);
  } else if (tweakPrompt) {
    contextParts.push(`\n=== ADDITIONAL INSTRUCTION ===\n${tweakPrompt}`);
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
