import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: key });
}

type GalleryIdea = {
  id: string;
  title: string;
  caption: string;
  imageUrl: string;
  suggestedSegment: string;
  suggestedTask: string;
  materialHint: string;
  quantityHint: number;
  unitHint: string;
  confidence: number;
  searchQuery: string;
};

type DetailQuestion = {
  id: string;
  question: string;
  placeholder?: string;
  required?: boolean;
};

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function isPlaceholderTask(input: string): boolean {
  const v = input.toLowerCase().trim();
  return !v || v.length < 3 || ["new", "other", "misc", "general", "work", "renovation"].includes(v);
}

function normalizeSegment(input: string): string {
  const s = input.trim();
  if (!s || isPlaceholderTask(s)) return "General";
  return s;
}

function normalizeUnit(input: string): string {
  const u = input.toLowerCase().trim();
  if (u.includes("sqft") || u.includes("sq ft") || u.includes("square")) return "sqft";
  if (u.includes("linear") || u === "lf") return "lf";
  if (u.includes("each") || u.includes("item")) return "each";
  if (u.includes("room")) return "room";
  return "sqft";
}

function toPositiveQuantity(value: unknown, unit: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (unit === "sqft") return 100;
  if (unit === "lf") return 20;
  return 1;
}

function dedupeKey(segment: string, task: string): string {
  return `${segment.toLowerCase().trim()}::${task.toLowerCase().trim()}`;
}

function makeAiFallbackImageUrl(query: string): string {
  const prompt = `renovation finish photo, ${query}, realistic, bright interior`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=640&height=480&nologo=true`;
}

async function searchStockImage(query: string): Promise<string | null> {
  const key = process.env.STOCK_IMAGE_API_KEY;
  if (!key) return null;
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: key },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      photos?: Array<{ src?: { large?: string; medium?: string } }>;
    };
    const photo = data.photos?.[0];
    return photo?.src?.large ?? photo?.src?.medium ?? null;
  } catch {
    return null;
  }
}

async function withImages(ideas: Omit<GalleryIdea, "imageUrl">[]): Promise<GalleryIdea[]> {
  const results = await Promise.all(
    ideas.map(async (idea) => {
      const stockUrl = await searchStockImage(idea.searchQuery || idea.title);
      return {
        ...idea,
        imageUrl: stockUrl ?? makeAiFallbackImageUrl(idea.searchQuery || idea.title),
      };
    })
  );
  return results;
}

function defaultIdeas(project: {
  sqft: string;
  workTypes?: string | null;
  rooms?: string | null;
}): Omit<GalleryIdea, "imageUrl">[] {
  const sqft = Number.parseFloat(project.sqft) || 1200;
  const work = new Set((project.workTypes ?? "").split(",").filter(Boolean));
  const rooms = new Set((project.rooms ?? "").split(",").filter(Boolean));
  const base: Omit<GalleryIdea, "imageUrl">[] = [
    {
      id: "bathroom-floor-tile",
      title: "Finished tiled bathroom floor",
      caption: "Porcelain tile floor with clean grout lines and modern trim.",
      suggestedSegment: rooms.has("bathroom") ? "Bathroom" : "Main Bath",
      suggestedTask: "Install finished porcelain bathroom floor tile",
      materialHint: "porcelain tile + thinset + grout",
      quantityHint: Math.max(30, Math.round(sqft * 0.05)),
      unitHint: "sqft",
      confidence: 0.78,
      searchQuery: "finished tiled bathroom floor renovation",
    },
    {
      id: "modern-vanity",
      title: "Custom modern vanity install",
      caption: "Medium-cost vanity with sink/faucet and finished plumbing connections.",
      suggestedSegment: "Bathroom",
      suggestedTask: "Install custom modern vanity with sink and faucet",
      materialHint: "vanity + sink + faucet + plumbing trim",
      quantityHint: 1,
      unitHint: "each",
      confidence: 0.76,
      searchQuery: "modern bathroom vanity installation",
    },
    {
      id: "kitchen-backsplash",
      title: "Kitchen backsplash upgrade",
      caption: "Clean backsplash finish to complete counters and cabinets.",
      suggestedSegment: "Kitchen",
      suggestedTask: "Install finished kitchen backsplash tile",
      materialHint: "tile + thinset + grout + trim",
      quantityHint: 35,
      unitHint: "sqft",
      confidence: 0.74,
      searchQuery: "kitchen backsplash finished tile",
    },
    {
      id: "deck-20x14",
      title: "Build a 20x14 deck",
      caption: "Pressure-treated deck frame, boards, stairs, and guard details.",
      suggestedSegment: "Exterior",
      suggestedTask: "Build new 20x14 pressure-treated deck",
      materialHint: "pressure-treated lumber + fasteners + railing",
      quantityHint: 280,
      unitHint: "sqft",
      confidence: 0.71,
      searchQuery: "20x14 backyard deck build",
    },
    {
      id: "landscape-upgrade",
      title: "Landscaping curb appeal upgrade",
      caption: "Basic grading, edging, and fresh topsoil/mulch around front entry.",
      suggestedSegment: "Exterior",
      suggestedTask: "Upgrade landscaping and curb appeal zones",
      materialHint: "topsoil + mulch + edging",
      quantityHint: 1,
      unitHint: "each",
      confidence: 0.68,
      searchQuery: "residential landscaping front yard upgrade",
    },
  ];

  const includesFlooring = work.has("flooring");
  const includesPainting = work.has("painting");
  if (includesFlooring) {
    base.push({
      id: "whole-house-flooring-finish",
      title: "Whole-house flooring refresh",
      caption: "Consistent flooring finish across high-traffic living areas.",
      suggestedSegment: "Whole House",
      suggestedTask: "Install finished flooring across living areas",
      materialHint: "lvp/laminate + underlayment + transitions",
      quantityHint: Math.max(300, Math.round(sqft * 0.55)),
      unitHint: "sqft",
      confidence: 0.79,
      searchQuery: "whole house flooring installation finished look",
    });
  }
  if (includesPainting) {
    base.push({
      id: "whole-house-paint",
      title: "Whole-house paint finish",
      caption: "Walls/ceilings with patched prep and clean final coat.",
      suggestedSegment: "Whole House",
      suggestedTask: "Paint walls and ceilings with finish coat",
      materialHint: "primer + paint + caulking",
      quantityHint: Math.max(600, Math.round(sqft * 1.8)),
      unitHint: "sqft",
      confidence: 0.75,
      searchQuery: "interior house paint finished walls",
    });
  }

  return base.slice(0, 12);
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const mode = typeof body.mode === "string" ? body.mode : "ideas";
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: { scopes: { include: { items: true } }, photos: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (mode === "ideas") {
    const existing = project.scopes.flatMap((s) => s.items).slice(0, 40);
    const recentProjects = await prisma.project.findMany({
      where: { userId, id: { not: projectId } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { workTypes: true, rooms: true, jobPrompt: true, materialGrade: true },
    });

    let ideasNoImage: Omit<GalleryIdea, "imageUrl">[] = [];
    try {
      const openai = await getOpenAI();
      const context = {
        location: { province: project.province, sqft: project.sqft },
        selected: {
          workTypes: project.workTypes ?? "",
          rooms: project.rooms ?? "",
          materialGrade: project.materialGrade ?? "mid_range",
        },
        description: project.jobPrompt ?? "",
        currentScope: existing.map((i) => ({
          segment: i.segment,
          task: i.task,
          material: i.material,
          quantity: i.quantity,
          unit: i.unit,
        })),
        accountHistoryHints: recentProjects.map((p) => ({
          workTypes: p.workTypes,
          rooms: p.rooms,
          materialGrade: p.materialGrade,
          description: p.jobPrompt?.slice(0, 200) ?? "",
        })),
      };

      const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Generate practical renovation gallery idea cards. Return ONLY valid JSON array (8-12 items) with fields: id,title,caption,suggestedSegment,suggestedTask,materialHint,quantityHint,unitHint,confidence,searchQuery.",
          },
          {
            role: "user",
            content: `Create a scope-addition idea gallery from this compact context:\n${JSON.stringify(context)}\nRules: avoid duplicates with currentScope; keep each idea concise and add-ready.`,
          },
        ],
        max_tokens: 1400,
      });
      const text = r.choices[0]?.message?.content ?? "[]";
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) as unknown;
      if (Array.isArray(parsed)) {
        ideasNoImage = parsed
          .map((x) => x as Record<string, unknown>)
          .map((x, idx) => {
            const title = String(x.title ?? "").trim();
            const segment = normalizeSegment(String(x.suggestedSegment ?? "General"));
            const task = String(x.suggestedTask ?? title).trim();
            const unit = normalizeUnit(String(x.unitHint ?? "sqft"));
            const quantity = toPositiveQuantity(x.quantityHint, unit);
            return {
              id: String(x.id ?? slug(title || `idea-${idx}`)),
              title: title || `Idea ${idx + 1}`,
              caption: String(x.caption ?? "").trim() || "Common contractor scope addition.",
              suggestedSegment: segment,
              suggestedTask: task,
              materialHint: String(x.materialHint ?? "general").trim(),
              quantityHint: quantity,
              unitHint: unit,
              confidence:
                typeof x.confidence === "number" && Number.isFinite(x.confidence)
                  ? Math.max(0.3, Math.min(0.99, x.confidence))
                  : 0.65,
              searchQuery: String(x.searchQuery ?? (title || task)).trim(),
            };
          })
          .filter((x) => x.title && x.suggestedTask && !isPlaceholderTask(x.suggestedTask))
          .slice(0, 12);
      }
    } catch {
      ideasNoImage = [];
    }

    if (ideasNoImage.length === 0) {
      ideasNoImage = defaultIdeas(project);
    }

    const existingKeys = new Set(
      existing.map((i) => dedupeKey(normalizeSegment(i.segment), i.task))
    );
    const seen = new Set<string>();
    const deduped = ideasNoImage.filter((idea) => {
      const key = dedupeKey(idea.suggestedSegment, idea.suggestedTask);
      if (seen.has(key) || existingKeys.has(key)) return false;
      seen.add(key);
      return true;
    });

    const ideas = await withImages(deduped.slice(0, 12));
    return NextResponse.json({
      ideas,
      source: {
        stockEnabled: !!process.env.STOCK_IMAGE_API_KEY,
        fallback: "ai_image_url",
      },
    });
  }

  if (mode === "detail_questions") {
    const idea = body.idea as Partial<GalleryIdea> | undefined;
    if (!idea?.title) {
      return NextResponse.json({ error: "idea required" }, { status: 400 });
    }
    let questions: DetailQuestion[] = [];
    try {
      const openai = await getOpenAI();
      const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Return ONLY JSON array of 2-4 concise question objects for scope detailing: {id,question,placeholder,required}. First question must be required=true.",
          },
          {
            role: "user",
            content: `Project: ${project.address}, ${project.province}, ${project.sqft} sqft\nIdea: ${idea.title}\nTask: ${idea.suggestedTask ?? ""}\nGenerate practical follow-up questions.`,
          },
        ],
        max_tokens: 320,
      });
      const text = r.choices[0]?.message?.content ?? "[]";
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) as unknown;
      if (Array.isArray(parsed)) {
        questions = parsed
          .map((x) => x as Record<string, unknown>)
          .map((x, i) => ({
            id: String(x.id ?? `q_${i + 1}`),
            question: String(x.question ?? "").trim(),
            placeholder: String(x.placeholder ?? "").trim() || undefined,
            required: i === 0 || x.required === true,
          }))
          .filter((q) => q.id && q.question)
          .slice(0, 4);
      }
    } catch {
      questions = [];
    }
    if (questions.length === 0) {
      questions = [
        {
          id: "size_details",
          question: "What size/coverage should this include?",
          placeholder: "e.g., 45 sqft main bath",
          required: true,
        },
        {
          id: "finish_level",
          question: "What finish level or quality should we target?",
          placeholder: "e.g., medium DIY-ready finish",
          required: false,
        },
      ];
    }
    return NextResponse.json({ questions });
  }

  if (mode === "apply_idea") {
    const selectedIdeas = Array.isArray(body.selectedIdeas)
      ? (body.selectedIdeas as Array<{ idea: Partial<GalleryIdea>; answers?: Record<string, string> }>)
      : [];
    if (selectedIdeas.length === 0) {
      return NextResponse.json({ error: "selectedIdeas required" }, { status: 400 });
    }

    let mainScope = project.scopes.find((s) => s.name === "Main") ?? project.scopes[0];
    if (!mainScope) {
      mainScope = await prisma.scope.create({
        data: { projectId, name: "Main", description: "Generated scope", order: 0 },
        include: { items: true },
      });
    }

    const existingItems = project.scopes.flatMap((s) => s.items);
    const existingKeys = new Set(existingItems.map((i) => dedupeKey(normalizeSegment(i.segment), i.task)));
    const created: Array<{ id: string; segment: string; task: string }> = [];
    const skipped: string[] = [];
    const acceptedIdeas = selectedIdeas.slice(0, 3);

    for (const entry of acceptedIdeas) {
      const idea = entry.idea ?? {};
      const task = String(idea.suggestedTask ?? idea.title ?? "").trim();
      const segment = normalizeSegment(String(idea.suggestedSegment ?? "General"));
      if (!task || isPlaceholderTask(task)) {
        skipped.push("Skipped placeholder idea.");
        continue;
      }
      const key = dedupeKey(segment, task);
      if (existingKeys.has(key)) {
        skipped.push(`Skipped duplicate: ${task}`);
        continue;
      }

      const answersText = Object.entries(entry.answers ?? {})
        .filter(([, v]) => typeof v === "string" && v.trim())
        .map(([k, v]) => `${k}: ${v.trim()}`)
        .join(" | ");

      let generated = {
        segment,
        task,
        material: String(idea.materialHint ?? "general").trim() || "general",
        quantity: toPositiveQuantity(idea.quantityHint, normalizeUnit(String(idea.unitHint ?? "sqft"))),
        unit: normalizeUnit(String(idea.unitHint ?? "sqft")),
        laborHours: 6,
      };

      try {
        const openai = await getOpenAI();
        const r = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Return ONLY JSON object for one scope item: {segment,task,material,quantity,unit,laborHours}. Keep practical and concise.",
            },
            {
              role: "user",
              content: `Project: ${project.province}, ${project.sqft} sqft\nIdea title: ${idea.title ?? ""}\nIdea task: ${task}\nIdea hints: material=${idea.materialHint ?? ""}, quantity=${idea.quantityHint ?? ""}, unit=${idea.unitHint ?? ""}\nUser answers: ${answersText || "none"}\nGenerate one add-ready scope item.`,
            },
          ],
          max_tokens: 220,
        });
        const text = r.choices[0]?.message?.content ?? "{}";
        const obj = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) as Record<string, unknown>;
        const unit = normalizeUnit(String(obj.unit ?? generated.unit));
        generated = {
          segment: normalizeSegment(String(obj.segment ?? generated.segment)),
          task: String(obj.task ?? generated.task).trim(),
          material: String(obj.material ?? generated.material).trim() || generated.material,
          quantity: toPositiveQuantity(obj.quantity, unit),
          unit,
          laborHours:
            typeof obj.laborHours === "number" && Number.isFinite(obj.laborHours) && obj.laborHours >= 0
              ? obj.laborHours
              : generated.laborHours,
        };
      } catch {
        // fallback generated item above
      }

      if (isPlaceholderTask(generated.task)) {
        skipped.push("Skipped invalid generated task.");
        continue;
      }
      const finalKey = dedupeKey(generated.segment, generated.task);
      if (existingKeys.has(finalKey)) {
        skipped.push(`Skipped duplicate: ${generated.task}`);
        continue;
      }

      const item = await prisma.scopeItem.create({
        data: {
          scopeId: mainScope.id,
          segment: generated.segment,
          task: generated.task,
          material: generated.material,
          quantity: generated.quantity,
          unit: generated.unit,
          laborHours: generated.laborHours,
          source: "AI",
        },
      });
      existingKeys.add(finalKey);
      created.push({ id: item.id, segment: item.segment, task: item.task });
    }

    return NextResponse.json({
      created,
      skipped,
      inserted: created.length,
      cappedTo: 3,
    });
  }

  return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
}
