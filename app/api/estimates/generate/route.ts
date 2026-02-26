import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeEstimate } from "@/lib/pricing/canadaPricingEngine";
import {
  getFallbackLaborSqftRate,
  getFallbackMaterialUnitCost,
  type PricePoint,
} from "@/lib/pricing/fallbackPriceCatalog";
import { matchFlyerItemsForLine } from "@/lib/flyers";
import { trackAiUsage } from "@/lib/aiUsage";

async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: key });
}

async function searchSupplierWebWithMeta(
  query: string,
  tracking?: { userId: string; projectId?: string; operation?: string }
): Promise<{
  text: string;
  hitCount: number;
  results: Array<{ title: string; content: string; url: string }>;
}> {
  try {
    const openai = await getOpenAI();
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini-search-preview",
      messages: [
        {
          role: "system",
          content:
            "Search current supplier evidence and return ONLY valid JSON array with up to 5 items: [{\"title\":string,\"content\":string,\"url\":string}]. Prefer homedepot.ca and rona.ca where possible.",
        },
        { role: "user", content: query },
      ],
      max_tokens: 500,
    });
    if (tracking) {
      await trackAiUsage({
        userId: tracking.userId,
        projectId: tracking.projectId,
        route: "/api/estimates/generate",
        operation: tracking.operation ?? "supplier_search",
        model: "gpt-4o-mini-search-preview",
        usage: res.usage,
      });
    }
    const raw = res.choices[0]?.message?.content ?? "[]";
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim()) as unknown;
    const results = Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
          .map((r) => ({
            title: String(r.title ?? "").trim(),
            content: String(r.content ?? "").trim(),
            url: String(r.url ?? "").trim(),
          }))
          .filter((r) => r.title && /^https?:\/\//.test(r.url))
          .slice(0, 5)
      : [];
    return {
      hitCount: results.length,
      text: results.map((r) => `[${r.title}] ${r.content} (${r.url})`).join("\n\n"),
      results,
    };
  } catch {
    return { text: "", hitCount: 0, results: [] };
  }
}

function extractSqftRates(text: string): number[] {
  // Match forms like "$8/sqft", "$8.50 per sq ft", "10 / sqft"
  const regex = /\$?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/|per)?\s*(?:sq\.?\s*ft|sqft|square\s*foot)/gi;
  const out: number[] = [];
  let m: RegExpExecArray | null = null;
  while ((m = regex.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0.25 && n < 250) out.push(n);
  }
  return out;
}

async function inferSqftRateFromSearchText(
  category: string,
  province: string,
  searchText: string
): Promise<number | null> {
  if (!searchText.trim()) return null;
  try {
    const openai = await getOpenAI();
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You estimate labor CAD per sqft from web snippets. Return ONLY JSON: {\"cadPerSqft\": number|null}. Use a realistic single value.",
        },
        {
          role: "user",
          content: `Category: ${category}\nProvince: ${province}\n\nWeb snippets:\n${searchText}\n\nInfer one realistic CAD/sqft labor rate.`,
        },
      ],
      max_tokens: 120,
    });
    const text = res.choices[0]?.message?.content ?? "{\"cadPerSqft\":null}";
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) as {
      cadPerSqft?: number | null;
    };
    const n = parsed.cadPerSqft;
    if (typeof n === "number" && Number.isFinite(n) && n > 0.25 && n < 250) return n;
    return null;
  } catch {
    return null;
  }
}

function inferLaborCategory(task: string, material: string): string {
  const t = `${task} ${material}`.toLowerCase();
  if (/paint/.test(t)) return "painting";
  if (/tile|tiling/.test(t)) return "tiling";
  if (/drywall|taping|mud/.test(t)) return "drywall";
  if (/floor|vinyl|laminate|hardwood|lvp|lvt/.test(t)) return "flooring";
  if (/demo|demolition|tear\s?out|remove|gut/.test(t)) return "demolition";
  if (/kitchen/.test(t)) return "kitchen";
  if (/bath/.test(t)) return "bathroom";
  return "general";
}

function inferLaborCategoryFromPricingKey(key: string): string {
  const k = key.toLowerCase();
  if (k.includes("paint") || k.includes("wall")) return "painting";
  if (k.includes("tile")) return "tiling";
  if (k.includes("drywall") || k.includes("taping") || k.includes("mud")) return "drywall";
  if (
    k.includes("floor") ||
    k.includes("vinyl") ||
    k.includes("laminate") ||
    k.includes("lvp") ||
    k.includes("lvt") ||
    k.includes("hardwood")
  ) {
    return "flooring";
  }
  if (k.includes("demo")) return "demolition";
  if (k.includes("kitchen")) return "kitchen";
  if (k.includes("bath")) return "bathroom";
  return "general";
}

function isGenericPlaceholderValue(input: string): boolean {
  const v = input.toLowerCase().trim();
  return (
    !v ||
    v.length < 3 ||
    ["new", "misc", "other", "general", "upgrade", "renovation", "improvement", "work"].includes(v)
  );
}

function normalizeSegmentLabel(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed || isGenericPlaceholderValue(trimmed)) return "General";
  return trimmed;
}

function estimateMaterialFloorTotal(line: {
  task: string;
  segment: string;
  unit: string;
  quantity: number;
  materialName?: string;
}): number {
  const unit = (line.unit ?? "").toLowerCase();
  const text = `${line.segment} ${line.task} ${line.materialName ?? ""}`.toLowerCase();
  const qty = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1;

  if (isDemolitionLike(line.task, line.segment, line.materialName ?? "")) return 0;

  if (unit.includes("sqft") || unit.includes("sq ft")) {
    let perSqft = 0.35;
    if (/tile|porcelain|backsplash|shower/.test(text)) perSqft = 1.75;
    else if (/floor|vinyl|laminate|hardwood|lvp|lvt|plank/.test(text)) perSqft = 1.5;
    else if (/drywall|taping|mud/.test(text)) perSqft = 0.65;
    else if (/cabinet|counter|vanity|sink/.test(text)) perSqft = 0.9;
    return qty * perSqft;
  }

  if (unit.includes("each") || unit.includes("set") || unit.includes("room")) {
    let each = 60;
    if (/vanity|sink|toilet|faucet/.test(text)) each = 120;
    if (/cabinet|door|hardware/.test(text)) each = 180;
    if (/counter|countertop/.test(text)) each = 250;
    if (/tile shower/.test(text)) each = 220;
    return qty * each;
  }

  if (unit.includes("house")) return 250;
  return qty * 50;
}

function slugifyCategory(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function titleCase(input: string): string {
  return input
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function inferSqftPricingKey(task: string, material: string): string | null {
  const t = `${task} ${material}`.toLowerCase();
  if (/floor|vinyl|laminate|hardwood|lvp|lvt|plank/.test(t)) return "flooring_sqft";
  if (/paint|wall/.test(t) && !/taping/.test(t)) return "walls_sqft";
  if (/tile|tiling/.test(t)) return "tiling_sqft";
  if (/drywall|taping|mud/.test(t)) return "drywall_taping_sqft";
  return null;
}

function candidateSqftPricingKeys(task: string, material: string): string[] {
  const keys: string[] = [];
  const legacy = inferSqftPricingKey(task, material);
  if (legacy) keys.push(legacy);
  const cat = inferLaborCategory(task, material);
  const slug = slugifyCategory(cat);
  if (slug) {
    keys.push(`labor_${slug}_sqft`);
    keys.push(`${slug}_sqft`);
  }
  // de-dupe preserve order
  return Array.from(new Set(keys));
}

async function buildLaborBenchmarkContext(
  scopeLines: Array<{ task: string; material: string; unit: string }>,
  province: string,
  userSqftRates?: Record<string, number>,
  tracking?: { userId: string; projectId?: string }
): Promise<{
  contextText: string;
  avgByCategory: Record<string, number>;
  overallAvg: number | null;
  searchQueries: number;
  searchHits: number;
}> {
  const categoryToKey: Record<string, string> = {
    flooring: "flooring_sqft",
    painting: "walls_sqft",
    tiling: "tiling_sqft",
    drywall: "drywall_taping_sqft",
  };
  const categories = Array.from(
    new Set(
      scopeLines
        .filter((l) => (l.unit ?? "").toLowerCase().includes("sqft") || (l.unit ?? "").toLowerCase().includes("sq ft"))
        .map((l) => inferLaborCategory(l.task, l.material))
    )
  ).slice(0, 6);

  if (categories.length === 0) {
    return { contextText: "", avgByCategory: {}, overallAvg: null, searchQueries: 0, searchHits: 0 };
  }

  const queryPlan = categories
    .map((cat) => {
      const key = categoryToKey[cat];
      const userRate = key ? userSqftRates?.[key] : undefined;
      return { cat, key, userRate };
    });
  const queries = queryPlan
    .filter((p) => !(p.userRate && p.userRate > 0))
    .map((p) => ({
      cat: p.cat,
      query: `${p.cat} labor cost per square foot ${province} Canada what homeowners paid forum reddit contractor quote`,
    }));
  const results = await Promise.all(
    queries.map((q) =>
      searchSupplierWebWithMeta(q.query, tracking ? { ...tracking, operation: "labor_benchmark_search" } : undefined)
    )
  );
  const searchQueries = queries.length;
  const searchHits = results.reduce((s, r) => s + r.hitCount, 0);

  const avgByCategory: Record<string, number> = {};
  const allRates: number[] = [];
  const lines: string[] = [];
  for (const plan of queryPlan) {
    const cat = plan.cat;
    if (plan.userRate && plan.userRate > 0) {
      avgByCategory[cat] = plan.userRate;
      allRates.push(plan.userRate);
      lines.push(`${cat}: ${plan.userRate.toFixed(2)} CAD/sqft (from saved user setting)`);
      continue;
    }
    const idx = queries.findIndex((q) => q.cat === cat);
    const text = idx >= 0 ? results[idx]?.text || "" : "";
    const rates = extractSqftRates(text);
    if (rates.length > 0) {
      const avg = rates.reduce((s, n) => s + n, 0) / rates.length;
      avgByCategory[cat] = avg;
      allRates.push(...rates);
      lines.push(`${cat}: avg ${avg.toFixed(2)} CAD/sqft from ${rates.length} mentions`);
    }
  }
  const overallAvg =
    allRates.length > 0 ? allRates.reduce((s, n) => s + n, 0) / allRates.length : null;
  const contextText =
    lines.length > 0
      ? `Labor benchmarks (online paid rates):\n${lines.join("\n")}\nOverall avg: ${
          overallAvg ? overallAvg.toFixed(2) : "n/a"
        } CAD/sqft`
      : "";

  return { contextText, avgByCategory, overallAvg, searchQueries, searchHits };
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
  laborRate?: number;
  laborUnitRate?: number;
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

type ItemInsight = {
  summary?: string;
  links?: Array<{ label: string; url: string; price?: number }>;
  imageUrl?: string;
  updatedAt?: string;
};

type LaborRateSuggestion = {
  category?: string;
  key: string;
  label: string;
  suggestedRate: number;
  internetAvg?: number;
  savedRate?: number | null;
  rationale?: string;
  sources: Array<{ title: string; url: string }>;
};

async function getLaborSuggestionWithOpenAISearch(params: {
  category: string;
  province: string;
  address?: string;
  savedRate?: number | null;
  key: string;
  label: string;
  tracking?: { userId: string; projectId?: string };
}): Promise<LaborRateSuggestion | null> {
  try {
    const openai = await getOpenAI();
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini-search-preview",
      messages: [
        {
          role: "system",
          content:
            "You are a Canadian construction labor pricing analyst. Use live web search and return ONLY valid JSON.",
        },
        {
          role: "user",
          content: `Find current labor cost per square foot in CAD for ${params.category} work in ${params.province}, Canada.
Location hint: ${params.address ?? "not provided"}.
Return ONLY JSON:
{
  "internetAvg": number,
  "rationale": string,
  "sources": [{ "title": string, "url": string }]
}
Rules:
- Use realistic labor-only sqft rates.
- Include 3-8 sources if possible.
- If sparse data, infer a practical midpoint and say so in rationale.`,
        },
      ],
      max_tokens: 500,
    });
    if (params.tracking) {
      await trackAiUsage({
        userId: params.tracking.userId,
        projectId: params.tracking.projectId,
        route: "/api/estimates/generate",
        operation: "labor_suggestion_search",
        model: "gpt-4o-mini-search-preview",
        usage: res.usage,
        metadata: { category: params.category },
      });
    }
    const text = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) as {
      internetAvg?: number;
      rationale?: string;
      sources?: Array<{ title?: string; url?: string }>;
    };
    const avg = parsed.internetAvg;
    if (!(typeof avg === "number" && Number.isFinite(avg) && avg > 0.25 && avg < 250)) return null;
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources
          .map((s) => ({ title: String(s.title ?? "").trim(), url: String(s.url ?? "").trim() }))
          .filter((s) => s.title && /^https?:\/\//.test(s.url))
          .slice(0, 8)
      : [];
    const savedRate = params.savedRate ?? null;
    return {
      category: params.category,
      key: params.key,
      label: params.label,
      suggestedRate: Number((savedRate && savedRate > 0 ? savedRate : avg).toFixed(2)),
      internetAvg: Number(avg.toFixed(2)),
      savedRate: typeof savedRate === "number" ? Number(savedRate.toFixed(2)) : null,
      rationale: parsed.rationale || "Derived from OpenAI web search.",
      sources,
    };
  } catch {
    return null;
  }
}

const LABOR_CATEGORY_MAP: Record<string, { key: string; label: string; query: string }> = {
  flooring: {
    key: "flooring_sqft",
    label: "Flooring install labor ($/sqft)",
    query: "flooring install labor cost per square foot",
  },
  painting: {
    key: "walls_sqft",
    label: "Painting labor ($/sqft)",
    query: "interior painting labor cost per square foot",
  },
  tiling: {
    key: "tiling_sqft",
    label: "Tiling labor ($/sqft)",
    query: "tile installation labor cost per square foot",
  },
  drywall: {
    key: "drywall_taping_sqft",
    label: "Drywall/taping labor ($/sqft)",
    query: "drywall taping and mudding labor cost per square foot",
  },
  demolition: {
    key: "demo_sqft",
    label: "Demolition labor ($/sqft)",
    query: "interior demolition labor cost per square foot",
  },
  kitchen: {
    key: "kitchen_finish_sqft",
    label: "Kitchen finish labor ($/sqft)",
    query: "kitchen renovation labor cost per square foot",
  },
  bathroom: {
    key: "bathroom_finish_sqft",
    label: "Bathroom finish labor ($/sqft)",
    query: "bathroom renovation labor cost per square foot",
  },
  general: {
    key: "general_sqft",
    label: "General finish labor ($/sqft)",
    query: "interior finishing labor cost per square foot",
  },
};

function getLaborCategoryMeta(cat: string) {
  if (LABOR_CATEGORY_MAP[cat]) return LABOR_CATEGORY_MAP[cat];
  const slug = slugifyCategory(cat);
  return {
    key: `labor_${slug || "general"}_sqft`,
    label: `${titleCase(slug || cat || "General")} labor ($/sqft)`,
    query: `${cat} labor cost per square foot`,
  };
}

function getTargetLaborCategories(
  scopeItems: Array<{ task: string; material: string; unit: string }>
) {
  const inferred = Array.from(
    new Set(
      scopeItems
        .filter((i) => i.unit.toLowerCase().includes("sqft") || i.unit.toLowerCase().includes("sq ft"))
        .map((i) => inferLaborCategory(i.task, i.material))
    )
  );
  const priority = [
    ...inferred.filter((c) => c in LABOR_CATEGORY_MAP),
    "drywall",
    "painting",
    "flooring",
    "tiling",
    "demolition",
    "kitchen",
    "bathroom",
    "general",
  ];
  return Array.from(new Set(priority)).slice(0, 8);
}

function buildBroadLaborQueries(base: string, province: string, address?: string) {
  const locationHints = [province, address ?? ""].filter(Boolean).join(" ");
  return [
    `${base} ${locationHints} Canada what homeowners paid`,
    `${base} ${locationHints} Canada contractor rates`,
    `${base} ${locationHints} reddit forum`,
    `${base} ${locationHints} quote range`,
    `${base} Canada price guide`,
  ];
}

function isDemolitionLike(task: string, segment: string, material: string) {
  const text = `${task} ${segment} ${material}`.toLowerCase();
  return /demo|demolition|tear\s?out|remove|removal|strip\s?out|gut|disposal/.test(text);
}

function percentile75(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.75 * (sorted.length - 1)));
  return sorted[idx];
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, n) => s + n, 0) / values.length;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function extractPreferredMaterialUnitCap(itemAnswers: Record<string, string>): number | null {
  const entries = Object.entries(itemAnswers ?? {});
  if (entries.length === 0) return null;
  for (const [key, raw] of entries) {
    const v = String(raw ?? "").toLowerCase().trim();
    if (!v) continue;
    const k = key.toLowerCase();
    const mentionsMaterial = /material|floor|tile|vinyl|laminate|plank/.test(k) || /material|floor|tile|vinyl|laminate|plank/.test(v);
    const mentionsCapIntent = /prefer|max|cap|budget|would pay|target|ceiling|limit/.test(k) || /prefer|max|cap|budget|would pay|target|ceiling|limit/.test(v);
    if (!mentionsMaterial || !mentionsCapIntent) continue;
    const nums = Array.from(v.matchAll(/\$?\s*(\d{1,3}(?:\.\d{1,2})?)/g))
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0.05 && n < 500);
    if (nums.length === 0) continue;
    // If user typed a range (e.g. 3-4), treat the upper bound as a cap.
    const cap = Math.max(...nums);
    if (Number.isFinite(cap) && cap > 0) return cap;
  }
  return null;
}

function dedupeReferenceLinks(
  links: Array<{ label: string; url: string; price?: number }>
): Array<{ label: string; url: string; price?: number }> {
  const seen = new Set<string>();
  const out: Array<{ label: string; url: string; price?: number }> = [];
  for (const link of links) {
    const normalizedUrl = String(link.url ?? "").trim().replace(/\/+$/, "").toLowerCase();
    if (!normalizedUrl) continue;
    const normalizedLabel = String(link.label ?? "").trim().toLowerCase();
    const key = `${normalizedUrl}::${normalizedLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...link, url: normalizedUrl });
  }
  return out;
}

function getFallbackLaborHourlyRate(category: string, pricePoint: PricePoint): number {
  const baseByCategory: Record<string, number> = {
    painting: 45,
    tiling: 55,
    drywall: 45,
    flooring: 50,
    demolition: 40,
    kitchen: 65,
    bathroom: 65,
    general: 45,
  };
  const base = baseByCategory[category] ?? baseByCategory.general;
  const multiplier = pricePoint === "low" ? 0.9 : pricePoint === "high" ? 1.2 : 1;
  return Math.max(30, Number((base * multiplier).toFixed(2)));
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId ?? req.nextUrl.searchParams.get("projectId");
  const mode = typeof body.mode === "string" ? body.mode : "generate";
  const repriceProfile =
    body.repriceProfile === "balanced" || body.repriceProfile === "aggressive"
      ? (body.repriceProfile as "balanced" | "aggressive")
      : "balanced";
  const pricePoint: PricePoint =
    body.pricePoint === "low" || body.pricePoint === "medium" || body.pricePoint === "high"
      ? (body.pricePoint as PricePoint)
      : repriceProfile === "aggressive"
        ? "high"
        : "medium";
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
      where: { id: projectId, userId },
      include: { scopes: { include: { items: true } } },
    }),
    prisma.userPricing.findMany({ where: { userId } }),
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

  const previousAssumptions = (latestEstimate?.assumptions as Record<string, unknown> | null) ?? null;
  const itemInsights: Record<string, ItemInsight> = {
    ...((previousAssumptions?.itemInsights as Record<string, ItemInsight> | undefined) ?? {}),
  };

  if (mode === "labor_rate_suggestions") {
    const targetCategories = getTargetLaborCategories(allScopeItems);
    const savedRates = Object.fromEntries(userPricing.map((p) => [p.key, p.rate])) as Record<string, number>;
    const requestedCategory = typeof body.category === "string" ? body.category.trim() : "";

    if (requestedCategory) {
      const mapped = getLaborCategoryMeta(requestedCategory);
      const savedRate = savedRates[mapped.key];

      // First try OpenAI built-in search model (live web style).
      const openAiSearchSuggestion = await getLaborSuggestionWithOpenAISearch({
        category: requestedCategory,
        province: project.province,
        address: project.address,
        savedRate: typeof savedRate === "number" ? savedRate : null,
        key: mapped.key,
        label: mapped.label,
        tracking: { userId, projectId: project.id },
      });
      if (openAiSearchSuggestion) {
        return NextResponse.json({
          suggestion: openAiSearchSuggestion,
          search: {
            provider: "openai_search",
            totalSources: openAiSearchSuggestion.sources.length,
          },
        });
      }
      const fallbackAvg = getFallbackLaborSqftRate(requestedCategory, pricePoint);
      const suggestion: LaborRateSuggestion = {
        category: requestedCategory,
        key: mapped.key,
        label: mapped.label,
        suggestedRate: Number((savedRate && savedRate > 0 ? savedRate : fallbackAvg).toFixed(2)),
        rationale:
          `OpenAI search had sparse signals for ${requestedCategory}; using ${pricePoint} fallback (${fallbackAvg.toFixed(2)} CAD/sqft).`,
        sources: [],
        internetAvg: Number(fallbackAvg.toFixed(2)),
        savedRate: typeof savedRate === "number" ? Number(savedRate.toFixed(2)) : null,
      };
      return NextResponse.json({
        suggestion,
        search: {
          provider: "openai_search",
          totalSources: suggestion.sources.length,
        },
      });
    }

    // Plan mode: return skeleton quickly so UI can populate progressively while fetching each category.
    const plan = targetCategories.map((cat) => {
      const mapped = getLaborCategoryMeta(cat);
      const savedRate = savedRates[mapped.key];
      return {
        category: cat,
        key: mapped.key,
        label: mapped.label,
        savedRate: typeof savedRate === "number" ? Number(savedRate.toFixed(2)) : null,
      };
    });
    return NextResponse.json({
      categories: plan,
      search: { provider: "openai_search" },
    });
  }

  if (mode === "item_questions") {
    const scopeItemId = typeof body.scopeItemId === "string" ? body.scopeItemId : "";
    const item = allScopeItems.find((s) => s.id === scopeItemId);
    if (!item) {
      return NextResponse.json({ error: "Scope item not found" }, { status: 404 });
    }
    const openai = await getOpenAI();
    const qRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Generate 3-4 concise clarification questions for a single renovation line item to improve pricing accuracy. Return only JSON array with {id,question,placeholder}.",
        },
        {
          role: "user",
          content: `Project: ${project.address}, ${project.province}, ${project.sqft} sqft\nItem: ${item.segment} | ${item.task} | ${item.material} | ${item.quantity} ${item.unit}`,
        },
      ],
      max_tokens: 350,
    });
    await trackAiUsage({
      userId,
      projectId: project.id,
      route: "/api/estimates/generate",
      operation: "item_questions",
      model: "gpt-4o-mini",
      usage: qRes.usage,
    });
    const text = qRes.choices[0]?.message?.content ?? "[]";
    let questions: Array<{ id: string; question: string; placeholder?: string }> = [];
    try {
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) as unknown;
      if (Array.isArray(parsed)) {
        questions = parsed
          .map((q) => q as Record<string, unknown>)
          .map((q) => ({
            id: String(q.id ?? "").trim(),
            question: String(q.question ?? "").trim(),
            placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
          }))
          .filter((q) => q.id && q.question)
          .slice(0, 4);
      }
    } catch {
      questions = [];
    }
    return NextResponse.json({ questions });
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
    await trackAiUsage({
      userId,
      projectId: project.id,
      route: "/api/estimates/generate",
      operation: "estimate_questions",
      model: "gpt-4o-mini",
      usage: qRes.usage,
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

  // Scope-first estimate: use current scope as primary, then check description for critical gaps.
  const estimateScopeItems = [...allScopeItems];
  let supplementalItemCount = 0;
  if (project.jobPrompt && mode !== "item_questions") {
    try {
      const openai = await getOpenAI();
      const scopeSummary = estimateScopeItems
        .map((i) => `- ${i.segment}: ${i.task} | ${i.material} | ${i.quantity} ${i.unit}`)
        .join("\n");
      const gapRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a renovation estimator. Compare job description vs current scope. Return ONLY missing critical estimate items not already covered (0-3 max). Return JSON array of {segment,task,material,quantity,unit,laborHours}.",
          },
          {
            role: "user",
            content: `Job description:\n${project.jobPrompt}\n\nCurrent scope:\n${scopeSummary}\n\nIf scope is complete, return []`,
          },
        ],
        max_tokens: 700,
      });
      await trackAiUsage({
        userId,
        projectId: project.id,
        route: "/api/estimates/generate",
        operation: "scope_gap_check",
        model: "gpt-4o-mini",
        usage: gapRes.usage,
      });
      const gapText = gapRes.choices[0]?.message?.content ?? "[]";
      const parsed = JSON.parse(gapText.replace(/```json\n?|\n?```/g, "").trim()) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        let mainScopeId = project.scopes.find((s) => s.name === "Main")?.id ?? project.scopes[0]?.id;
        if (!mainScopeId) {
          const createdScope = await prisma.scope.create({
            data: { projectId, name: "Main", description: "Auto scope", order: 0 },
          });
          mainScopeId = createdScope.id;
        }
        const additions = parsed
          .slice(0, 3)
          .map((x) => x as Record<string, unknown>)
          .map((x) => ({
            segment: normalizeSegmentLabel(String(x.segment ?? "General")),
            task: String(x.task ?? "").trim(),
            material: String(x.material ?? "general").trim(),
            quantity: typeof x.quantity === "number" ? x.quantity : 0,
            unit: String(x.unit ?? "sqft").trim(),
            laborHours: typeof x.laborHours === "number" ? x.laborHours : 0,
          }))
          .filter((x) => x.task && !isGenericPlaceholderValue(x.task) && x.quantity > 0);

        for (const add of additions) {
          const exists = estimateScopeItems.some(
            (s) =>
              s.segment.toLowerCase().trim() === add.segment.toLowerCase().trim() &&
              s.task.toLowerCase().trim() === add.task.toLowerCase().trim()
          );
          if (exists) continue;
          const created = await prisma.scopeItem.create({
            data: {
              scopeId: mainScopeId,
              segment: add.segment,
              task: add.task,
              material: add.material,
              quantity: add.quantity,
              unit: add.unit,
              laborHours: add.laborHours,
              source: "AI",
            },
          });
          estimateScopeItems.push(created);
          supplementalItemCount += 1;
        }
      }
    } catch {
      // no-op: keep original scope only
    }
  }

  const flyerItems = await prisma.flyerItem.findMany({
    where: { flyer: { userId } },
    include: { flyer: true },
    orderBy: [{ flyer: { releaseDate: "desc" } }, { createdAt: "desc" }],
    take: 400,
  });
  const flyerMatchesByScopeForEstimate = new Map<
    string,
    ReturnType<typeof matchFlyerItemsForLine>
  >();
  for (const s of estimateScopeItems) {
    const matches = matchFlyerItemsForLine(flyerItems, {
      task: s.task,
      material: s.material,
      materialName: s.material,
      unit: s.unit,
    });
    if (matches.length > 0) {
      flyerMatchesByScopeForEstimate.set(s.id, matches);
    }
  }

  const pricingMap = Object.fromEntries(
    userPricing.map((p) => [p.key, { rate: p.rate, unit: p.unit }])
  );
  const userSqftRates = Object.fromEntries(
    userPricing
      .filter((p) => (p.unit ?? "").toLowerCase().includes("sqft") || (p.unit ?? "").toLowerCase().includes("sq ft"))
      .map((p) => [p.key, p.rate])
  ) as Record<string, number>;
  const userSqftValues = Object.values(userSqftRates).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
  );
  const userSqftOverall =
    userSqftValues.length > 0
      ? userSqftValues.reduce((s, n) => s + n, 0) / userSqftValues.length
      : null;
  const userSqftByCategory = userPricing
    .filter((p) => (p.unit ?? "").toLowerCase().includes("sqft") || (p.unit ?? "").toLowerCase().includes("sq ft"))
    .reduce((acc, p) => {
      const cat = inferLaborCategoryFromPricingKey(p.key);
      const curr = acc[cat] ?? [];
      curr.push(p.rate);
      acc[cat] = curr;
      return acc;
    }, {} as Record<string, number[]>);
  const userSqftCategoryBench = Object.fromEntries(
    Object.entries(userSqftByCategory).map(([cat, values]) => [
      cat,
      values.reduce((s, n) => s + n, 0) / values.length,
    ])
  ) as Record<string, number>;
  const userHourlyRates = userPricing
    .filter((p) => {
      const u = (p.unit ?? "").toLowerCase();
      return u.includes("hr") || u.includes("hour");
    })
    .reduce((acc, p) => {
      const cat = inferLaborCategoryFromPricingKey(p.key);
      const curr = acc[cat] ?? [];
      curr.push(p.rate);
      acc[cat] = curr;
      return acc;
    }, {} as Record<string, number[]>);
  const userHourlyCategoryBench = Object.fromEntries(
    Object.entries(userHourlyRates).map(([cat, values]) => [
      cat,
      values.reduce((s, n) => s + n, 0) / values.length,
    ])
  ) as Record<string, number>;
  const userHourlyAll = Object.values(userHourlyCategoryBench).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
  );
  const userHourlyOverall =
    userHourlyAll.length > 0
      ? userHourlyAll.reduce((s, n) => s + n, 0) / userHourlyAll.length
      : null;
  const baselineResult = computeEstimate(project.province, estimateScopeItems, pricingMap);
  let usedAiPricing = false;

  const refinementForAi = Object.entries(refinementAnswers)
    .filter(([, v]) => v?.trim())
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as Record<string, string>);

  const laborBench = await buildLaborBenchmarkContext(
    estimateScopeItems.map((i) => ({ task: i.task, material: i.material, unit: i.unit })),
    project.province,
    userSqftRates,
    { userId, projectId: project.id }
  );
  const aiEstimateInputContext = {
    location: {
      province: project.province,
      address: project.address,
      sqft: project.sqft,
    },
    work: {
      description: project.jobPrompt ?? "",
      extraPrompt: estimatePrompt || "",
      refinementAnswers: refinementForAi,
    },
    userPricingBenchmarks: {
      sqftByCategory: userSqftCategoryBench,
      sqftOverall: userSqftOverall,
      hourlyByCategory: userHourlyCategoryBench,
      hourlyOverall: userHourlyOverall,
      sampleRates: userPricing.slice(0, 24).map((p) => ({ key: p.key, rate: p.rate, unit: p.unit })),
    },
    laborBenchmarks: {
      avgByCategory: laborBench.avgByCategory,
      overallAvg: laborBench.overallAvg,
    },
    lines: estimateScopeItems.map((i) => ({
      scopeItemId: i.id,
      segment: i.segment,
      task: i.task,
      material: i.material,
      quantity: i.quantity,
      unit: i.unit,
      laborHoursHint: i.laborHours ?? 0,
      flyerHints: (flyerMatchesByScopeForEstimate.get(i.id) ?? []).slice(0, 3).map((m) => ({
        name: m.name,
        unitLabel: m.unitLabel,
        price: m.price,
        promoNotes: m.promoNotes,
        storeName: m.flyer?.storeName ?? null,
      })),
    })),
  };
  const includeDebugSnapshot =
    process.env.NODE_ENV !== "production" || body.debugAiInput === true;
  const aiDebugSnapshot = includeDebugSnapshot
    ? {
        model: "gpt-4o-mini",
        generatedAt: new Date().toISOString(),
        context: aiEstimateInputContext,
      }
    : undefined;

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
          content: `Use this compact context JSON:
${JSON.stringify(aiEstimateInputContext)}

Return JSON array with one item per line:
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
- Keep quantity/unit aligned with the line intent.
- For labor/material, use user pricing benchmarks first; if missing, infer best judgment from similar categories and project context.
- For sqft lines, anchor labor to category sqft benchmarks when possible.
- When flyerHints exist on a line, treat them as strong local pricing evidence for material selections and unit costs.
- Avoid token placeholder values and unrealistic micro-costs.
- Always provide realistic laborRate (hourly) and materialUnitCost (>0) for every line.
- For non-sqft lines, laborHours × laborRate should produce a practical labor total for the scope line.
- Set pricingSource="user" when directly aligned with user benchmark data; otherwise "default".`,
        },
      ],
      max_tokens: 1800,
    });
    await trackAiUsage({
      userId,
      projectId: project.id,
      route: "/api/estimates/generate",
      operation: "estimate_line_pricing",
      model: "gpt-4o-mini",
      usage: aiRes.usage,
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

  // Second LLM pass: when first pass is sparse on labor/material fields, fill missing variables
  // using user benchmarks + project context before falling back to static tables.
  const aiById = new Map(aiLines.map((l) => [l.scopeItemId, l]));
  const weakLineInputs = estimateScopeItems
    .map((s) => {
      const l = aiById.get(s.id);
      const missingLabor = !(typeof l?.laborHours === "number" && Number.isFinite(l.laborHours) && l.laborHours > 0);
      const missingLaborRate = !(typeof l?.laborRate === "number" && Number.isFinite(l.laborRate) && l.laborRate > 0);
      const missingMaterial = !(typeof l?.materialUnitCost === "number" && Number.isFinite(l.materialUnitCost) && l.materialUnitCost > 0);
      if (!missingLabor && !missingLaborRate && !missingMaterial) return null;
      return {
        scopeItemId: s.id,
        segment: s.segment,
        task: s.task,
        material: s.material,
        quantity: s.quantity,
        unit: s.unit,
        laborHoursHint: s.laborHours ?? 0,
        laborRateHint: l?.laborRate,
        flyerHints: (flyerMatchesByScopeForEstimate.get(s.id) ?? []).slice(0, 3).map((m) => ({
          name: m.name,
          unitLabel: m.unitLabel,
          price: m.price,
          promoNotes: m.promoNotes,
          storeName: m.flyer?.storeName ?? null,
        })),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 16);

  if (weakLineInputs.length > 0) {
    try {
      const openai = await getOpenAI();
      const fillRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You patch missing renovation estimate variables. Return ONLY valid JSON array with {scopeItemId,laborHours,laborRate,materialUnitCost,materialName,notes}.",
          },
          {
            role: "user",
            content: `Context:
${JSON.stringify({
  location: aiEstimateInputContext.location,
  userPricingBenchmarks: aiEstimateInputContext.userPricingBenchmarks,
  laborBenchmarks: aiEstimateInputContext.laborBenchmarks,
  weakLines: weakLineInputs,
})}

Rules:
- Fill realistic laborHours/laborRate/materialUnitCost for each weak line.
- Prioritize user pricing benchmarks where applicable.
- Use flyerHints as local context when relevant to the weak line material/task.
- If uncertain, infer practical mid-range values for MB/Canada.
- materialUnitCost must be > 0; laborHours must be >= 0; laborRate must be >= 30 for skilled trades.`,
          },
        ],
        max_tokens: 1000,
      });
      await trackAiUsage({
        userId,
        projectId: project.id,
        route: "/api/estimates/generate",
        operation: "estimate_fill_missing_values",
        model: "gpt-4o-mini",
        usage: fillRes.usage,
      });
      const fillText = fillRes.choices[0]?.message?.content ?? "[]";
      const fillParsed = JSON.parse(fillText.replace(/```json\n?|\n?```/g, "").trim()) as unknown;
      if (Array.isArray(fillParsed)) {
        for (const obj of fillParsed) {
          const x = obj as Record<string, unknown>;
          const id = String(x.scopeItemId ?? "");
          if (!id) continue;
          const prev = aiById.get(id) ?? { scopeItemId: id };
          const next: AiEstimateLine = {
            ...prev,
            scopeItemId: id,
            laborHours:
              typeof x.laborHours === "number" && Number.isFinite(x.laborHours) && x.laborHours >= 0
                ? x.laborHours
                : prev.laborHours,
            laborRate:
              typeof x.laborRate === "number" && Number.isFinite(x.laborRate) && x.laborRate > 0
                ? x.laborRate
                : prev.laborRate,
            materialUnitCost:
              typeof x.materialUnitCost === "number" && Number.isFinite(x.materialUnitCost) && x.materialUnitCost > 0
                ? x.materialUnitCost
                : prev.materialUnitCost,
            materialName:
              typeof x.materialName === "string" && x.materialName.trim()
                ? x.materialName.trim()
                : prev.materialName,
            notes:
              typeof x.notes === "string" && x.notes.trim()
                ? x.notes.trim()
                : prev.notes,
          };
          aiById.set(id, next);
        }
      }
    } catch {
      // no-op; downstream logic will use existing AI values + benchmark fallback
    }
  }

  const scopeById = new Map(estimateScopeItems.map((s) => [s.id, s]));
  const lineWarnings: string[] = [];
  const pushLineWarning = (msg: string) => {
    if (!msg?.trim()) return;
    if (lineWarnings.length >= 12) return;
    if (!lineWarnings.includes(msg)) lineWarnings.push(msg);
  };
  const overlapWarnings = new Set<string>();
  if (supplementalItemCount > 0) {
    pushLineWarning(
      `Added ${supplementalItemCount} supplemental estimate item(s) from job description coverage check.`
    );
  }
  const baseLines = baselineResult.lines.map((line) => {
    const aiLine = aiById.get(line.scopeItemId);
    const quantity = aiLine?.quantity && aiLine.quantity > 0 ? aiLine.quantity : line.quantity;
    const unit = aiLine?.unit?.trim() ? aiLine.unit.trim() : line.unit;
    const laborHours = aiLine?.laborHours != null && aiLine.laborHours >= 0 ? aiLine.laborHours : line.laborHours;
    const materialName = aiLine?.materialName?.trim() ? aiLine.materialName.trim() : line.materialName;
    const inferredLineCategory = inferLaborCategory(line.task, materialName);
    const benchmarkLaborRate =
      userHourlyCategoryBench[inferredLineCategory] ??
      userHourlyCategoryBench.general ??
      userHourlyOverall ??
      line.laborRate;
    const fallbackHourlyRate = getFallbackLaborHourlyRate(inferredLineCategory, pricePoint);
    const laborRateRaw =
      aiLine?.laborRate != null && aiLine.laborRate > 0
        ? aiLine.laborRate
        : benchmarkLaborRate;
    const laborRate = Math.max(laborRateRaw, fallbackHourlyRate);
    const materialUnitCost = aiLine?.materialUnitCost != null && aiLine.materialUnitCost > 0 ? aiLine.materialUnitCost : line.materialUnitCost;
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

  let fallbackLaborCount = 0;
  let fallbackMaterialCount = 0;
  let adjustedLines = baseLines.map((line) => {
    const override = overrides[line.scopeItemId] ?? {};
    const scopeItem = scopeById.get(line.scopeItemId);
    let quantity = line.quantity;
    let laborHours = line.laborHours;
    let laborRate = line.laborRate;
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
    if (typeof override.laborRate === "number" && Number.isFinite(override.laborRate) && override.laborRate > 0) {
      laborRate = override.laborRate;
      if (laborRate !== line.laborRate) pricingSource = "user";
    }
    if (typeof override.materialUnitCost === "number" && Number.isFinite(override.materialUnitCost) && override.materialUnitCost > 0) {
      materialUnitCost = override.materialUnitCost;
      pricingSource = "user";
    }
    if (typeof override.materialName === "string" && override.materialName.trim()) {
      materialName = override.materialName.trim();
    }

    // Demo work is typically labor/equipment heavy with limited material consumption.
    // Prevent generic fallback rates (e.g., 4.95/sqft) from inflating demo material.
    if (isDemolitionLike(line.task, line.segment, materialName) && typeof override.materialUnitCost !== "number") {
      const unitLower = (line.unit ?? "").toLowerCase();
      if (unitLower.includes("sqft") || unitLower.includes("sq ft")) {
        materialUnitCost = Math.min(materialUnitCost, 0.75);
      } else if (unitLower.includes("each") || unitLower.includes("room") || unitLower.includes("house") || unitLower.includes("set")) {
        materialUnitCost = Math.min(materialUnitCost, 95);
      } else {
        materialUnitCost = Math.min(materialUnitCost, 25);
      }
    }

    let laborCost = (laborHours ?? 0) * laborRate;
    const lineCategory = inferLaborCategory(line.task, materialName);
    if (!(typeof override.laborRate === "number" && Number.isFinite(override.laborRate) && override.laborRate > 0)) {
      laborRate = Math.max(laborRate, getFallbackLaborHourlyRate(lineCategory, pricePoint));
    }
    const benchmarkSqft =
      laborBench.avgByCategory[lineCategory] ??
      laborBench.avgByCategory.general ??
      laborBench.overallAvg;
    const userSqftRate = candidateSqftPricingKeys(line.task, materialName)
      .map((k) => userSqftRates[k])
      .find((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
    const fallbackLaborSqft = getFallbackLaborSqftRate(lineCategory, pricePoint);
    const blendedSqftBenchmark =
      userSqftRate && benchmarkSqft
        ? (benchmarkSqft * 0.45 + userSqftRate * 0.55)
        : userSqftRate ??
          benchmarkSqft ??
          userSqftCategoryBench[lineCategory] ??
          userSqftCategoryBench.general ??
          userSqftOverall ??
          fallbackLaborSqft;
    const sqftLaborRateOverride =
      typeof override.laborUnitRate === "number" && Number.isFinite(override.laborUnitRate) && override.laborUnitRate > 0
        ? override.laborUnitRate
        : null;
    const appliedSqftLaborRate = sqftLaborRateOverride ?? blendedSqftBenchmark;
    if (
      appliedSqftLaborRate &&
      Number.isFinite(appliedSqftLaborRate) &&
      line.unit.toLowerCase().includes("sqft") &&
      quantity > 0
    ) {
      // For sqft-scoped work, labor should be directly based on sqft rate chosen/inferred.
      // This ensures the wizard + inferred sqft rates drive the estimate instead of hourly defaults.
      laborCost = quantity * appliedSqftLaborRate;
      laborHours = laborCost / (laborRate || 1);
      if (!sqftLaborRateOverride && !benchmarkSqft && !userSqftRate) fallbackLaborCount += 1;
      if (sqftLaborRateOverride) pricingSource = "user";
    }
    const fallbackMaterialUnit = getFallbackMaterialUnitCost(
      line.task,
      materialName,
      line.unit,
      pricePoint
    );
    if (
      fallbackMaterialUnit &&
      typeof override.materialUnitCost !== "number" &&
      (materialUnitCost <= 0 || materialUnitCost < fallbackMaterialUnit * 0.45)
    ) {
      materialUnitCost = fallbackMaterialUnit;
      fallbackMaterialCount += 1;
    }
    let materialCost = quantity * materialUnitCost;
    const materialFloor = estimateMaterialFloorTotal({
      task: line.task,
      segment: line.segment,
      unit: line.unit,
      quantity,
      materialName,
    });
    if (
      materialFloor > 0 &&
      materialCost < materialFloor &&
      typeof override.materialUnitCost !== "number"
    ) {
      materialCost = materialFloor;
      materialUnitCost = materialFloor / Math.max(quantity || 0, 1);
    }
    const subtotal = laborCost + materialCost;
    const markup = subtotal * MARKUP_PERCENT;
    const tax = (subtotal + markup) * ((baselineResult.assumptions.taxRate ?? 0));

    const taskLower = `${line.segment} ${line.task}`.toLowerCase();
    if (
      (taskLower.includes("kitchen") || taskLower.includes("bathroom") || taskLower.includes("plumbing") || taskLower.includes("electrical")) &&
      materialCost < Math.max(120, materialFloor * 0.8)
    ) {
      pushLineWarning(`Low material cost detected for "${line.task}" - review quantity/unit cost.`);
    }
    if (
      scopeItem &&
      /renovat|full|complete/i.test(scopeItem.task) &&
      /kitchen|bathroom|basement|whole/i.test(scopeItem.segment) &&
      /each|house|set/.test(line.unit.toLowerCase())
    ) {
      pushLineWarning(`Package "${line.task}" may be under-quantified (${line.quantity} ${line.unit}).`);
    }

    return {
      ...line,
      quantity,
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

  const beforeFilterCount = adjustedLines.length;
  adjustedLines = adjustedLines.filter((line) => {
    const taskIsPlaceholder = isGenericPlaceholderValue(line.task);
    const isZeroLine =
      (!Number.isFinite(line.quantity) || line.quantity <= 0) &&
      (!Number.isFinite(line.laborCost) || line.laborCost <= 0) &&
      (!Number.isFinite(line.materialCost) || line.materialCost <= 0);
    const totalIsZeroOrNegative = !Number.isFinite(line.total) || line.total <= 0;
    if (taskIsPlaceholder && totalIsZeroOrNegative) return false;
    if (isZeroLine || totalIsZeroOrNegative) return false;
    return true;
  });
  if (adjustedLines.length < beforeFilterCount) {
    pushLineWarning(
      `Filtered ${beforeFilterCount - adjustedLines.length} placeholder/zero-value estimate line(s).`
    );
  }
  if (fallbackLaborCount > 0 || fallbackMaterialCount > 0) {
    pushLineWarning(
      `Applied fallback pricing database (${pricePoint}) to ${fallbackLaborCount} labor and ${fallbackMaterialCount} material line(s).`
    );
  }

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

  let totalLabor = adjustedLines.reduce((s, l) => s + l.laborCost, 0);
  let totalMaterial = adjustedLines.reduce((s, l) => s + l.materialCost, 0);
  let markup = adjustedLines.reduce((s, l) => s + l.markup, 0);
  let tax = adjustedLines.reduce((s, l) => s + l.tax, 0);
  let grandTotal = totalLabor + totalMaterial + markup + tax;
  let searchSupplierQueries = 0;
  let searchSupplierHits = 0;

  const repriceReferences: Array<{
    scopeItemId: string;
    task: string;
    materialUnitCost: number;
    notes?: string;
    links: Array<{ label: string; url: string; price?: number }>;
  }> = [];

  // If caller asked to reprice materials, ask the AI to produce material breakdowns and updated unit costs.
  if (mode === "reprice" || mode === "item_reprice") {
    try {
      const openai = await getOpenAI();
      const requestedScopeItemId = typeof body.scopeItemId === "string" ? body.scopeItemId : "";
      const targetLines =
        mode === "item_reprice" && requestedScopeItemId
          ? adjustedLines.filter((l) => l.scopeItemId === requestedScopeItemId)
          : adjustedLines;
      if (targetLines.length === 0) {
        return NextResponse.json({ error: "Scope item not found for deep dive" }, { status: 404 });
      }

      const itemAnswers: Record<string, string> =
        body.itemAnswers && typeof body.itemAnswers === "object" ? body.itemAnswers : {};
      const preferredMaterialUnitCap = extractPreferredMaterialUnitCap(itemAnswers);
      const itemAnswersText = Object.entries(itemAnswers)
        .filter(([, v]) => v?.trim())
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n");

      const flyerMatchesByScopeItem = new Map<string, ReturnType<typeof matchFlyerItemsForLine>>();
      for (const line of targetLines) {
        const matches = matchFlyerItemsForLine(flyerItems, {
          task: line.task,
          material: line.material,
          materialName: line.materialName,
          unit: line.unit,
        });
        if (matches.length > 0) {
          flyerMatchesByScopeItem.set(line.scopeItemId, matches);
        }
      }
      const flyerContext = targetLines
        .map((line) => {
          const matches = flyerMatchesByScopeItem.get(line.scopeItemId) ?? [];
          if (matches.length === 0) return "";
          return [
            `Line ${line.scopeItemId} (${line.task}) local flyer evidence:`,
            ...matches.map(
              (m) =>
                `- ${m.name} @ ${m.price.toFixed(2)} CAD${m.unitLabel ? ` / ${m.unitLabel}` : ""} (${m.flyer?.storeName ?? "store unknown"}${m.flyer?.releaseDate ? `, release ${m.flyer.releaseDate.toISOString().slice(0, 10)}` : ""})`
            ),
          ].join("\n");
        })
        .filter(Boolean)
        .join("\n\n");

      const searchSeeds = targetLines
        .slice(0, 8)
        .map((l) => `${l.task} ${l.materialName || l.material} ${l.unit}`)
        .map((s) => s.trim())
        .filter(Boolean);
      const uniqueSeeds = Array.from(new Set(searchSeeds));
      const supplierQueries = uniqueSeeds.flatMap((seed) => [
        `site:homedepot.ca ${seed} ${project.province} price`,
        `site:rona.ca ${seed} ${project.province} price`,
      ]);
      searchSupplierQueries = supplierQueries.length;
      const supplierResults = await Promise.all(
        supplierQueries.map((q) =>
          searchSupplierWebWithMeta(q, {
            userId,
            projectId: project.id,
            operation: "material_supplier_search",
          })
        )
      );
      const supplierSearchContext = supplierResults.map((r) => r.text).filter(Boolean).join("\n\n---\n\n");
      const supplierHitCount = supplierResults.reduce((s, r) => s + r.hitCount, 0);
      searchSupplierHits = supplierHitCount;

      const materialPrompt = [
        "You are an expert construction materials estimator for Canadian markets.",
        "PROCESS ORDER (must follow):",
        "1) Start with a standard LLM estimate using project scope + user settings context.",
        "2) Cross-check against supplier search evidence (Home Depot Canada, RONA Canada).",
        "3) Decide final material unit cost with concise rationale and references.",
        "Output concise, practical, explainable numbers.",
        "If item clarifications include a preferred/budget max material cost per unit (e.g., per sqft), treat it as a hard cap unless it is clearly infeasible, and explicitly explain any exception in notes.",
        "Use matched local flyer prices as a preferred signal before broad web sources when they are relevant to the line item.",
        "PRIORITY SOURCES: Home Depot Canada (homedepot.ca) and RONA Canada (rona.ca). Use those first. If evidence is sparse, infer conservatively from similar items in those sources.",
        `Project: ${project.address}, ${project.province}, ${project.sqft} sqft`,
        `Scope lines:\n${targetLines
          .map((l) => `- id=${l.scopeItemId} | ${l.segment}: ${l.task} | ${l.quantity} ${l.unit} | material=${l.materialName ?? l.material}`)
          .join("\n")}`,
        itemAnswersText ? `Item clarifications:\n${itemAnswersText}` : "Item clarifications: none",
        flyerContext ? `Matched local flyer evidence:\n${flyerContext}` : "Matched local flyer evidence: none",
        `Supplier search evidence:\n${supplierSearchContext || "No supplier search evidence available; still provide conservative estimates."}`,
        "Return ONLY valid JSON in this format (example):\n[\n  {\n    \"scopeItemId\": \"string\",\n    \"materialUnitCost\": number, // suggested total material cost per unit used in the estimate\n    \"materialList\": [\n      { \"name\": \"string\", \"quantity\": number, \"unit\": \"string\", \"unitCost\": number, \"sourceUrl\": \"string\" }\n    ],\n    \"examples\": [ { \"label\": \"string\", \"price\": number, \"sourceUrl\": \"string\" } ],\n    \"imageUrl\": \"string\", // optional product image URL if available\n    \"notes\": \"string\"\n  }\n]\n- Prefer ranges and be conservative. Weight local (project province) sources higher. Provide human-readable notes explaining assumptions.",
        "Prefer ranges and be conservative. Weight local (project province) sources higher. Provide human-readable notes explaining assumptions.",
      ].join("\n\n");

      let mRes;
      try {
        mRes = await openai.chat.completions.create({
          model: "gpt-4o-mini-search-preview",
          messages: [
            { role: "system", content: "You are an expert estimator and cost accountant for renovation materials in Canada. Be conservative and realistic. Prefer homedepot.ca and rona.ca when available." },
            { role: "user", content: materialPrompt },
          ],
          max_tokens: 1200,
        });
        await trackAiUsage({
          userId,
          projectId: project.id,
          route: "/api/estimates/generate",
          operation: "material_reprice",
          model: "gpt-4o-mini-search-preview",
          usage: mRes.usage,
        });
      } catch {
        mRes = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are an expert estimator and cost accountant for renovation materials in Canada. Be conservative and realistic. Prefer homedepot.ca and rona.ca when available." },
            { role: "user", content: materialPrompt },
          ],
          max_tokens: 1200,
        });
        await trackAiUsage({
          userId,
          projectId: project.id,
          route: "/api/estimates/generate",
          operation: "material_reprice_fallback",
          model: "gpt-4o-mini",
          usage: mRes.usage,
        });
      }
      const mText = mRes.choices[0]?.message?.content ?? "[]";
      let parsedMaterials: Array<Record<string, unknown>> = [];
      try {
        parsedMaterials = JSON.parse(mText.replace(/```json\n?|\n?```/g, "").trim()) as Array<Record<string, unknown>>;
      } catch (e) {
        // ignore parse error - fallback to previous pricing
        parsedMaterials = [];
      }

      const materialMap = new Map<string, {
        materialUnitCost?: number;
        materialList?: Array<{ name?: string; unitCost?: number; sourceUrl?: string }>;
        examples?: Array<{ label?: string; price?: number; sourceUrl?: string }>;
        imageUrl?: string;
        notes?: string;
      }>();
      for (const obj of parsedMaterials) {
        const id = String(obj.scopeItemId ?? "");
        const cost = typeof obj.materialUnitCost === "number" ? obj.materialUnitCost : undefined;
        const list = Array.isArray(obj.materialList)
          ? (obj.materialList as Array<Record<string, unknown>>).map((it) => ({
              name: typeof it.name === "string" ? it.name : undefined,
              unitCost: typeof it.unitCost === "number" ? it.unitCost : undefined,
              sourceUrl: typeof it.sourceUrl === "string" ? it.sourceUrl : undefined,
            }))
          : undefined;
        const examples = Array.isArray(obj.examples)
          ? (obj.examples as Array<Record<string, unknown>>).map((it) => ({
              label: typeof it.label === "string" ? it.label : undefined,
              price: typeof it.price === "number" ? it.price : undefined,
              sourceUrl: typeof it.sourceUrl === "string" ? it.sourceUrl : undefined,
            }))
          : undefined;
        const notes = typeof obj.notes === "string" ? obj.notes : undefined;
        const imageUrl = typeof obj.imageUrl === "string" ? obj.imageUrl : undefined;
        // If materialList provides multiple unitCost examples, average them for robustness
        let averagedCost: number | undefined = cost;
        if ((!averagedCost || averagedCost <= 0) && list && list.length > 0) {
          const numericCosts = list
            .map((it) => (typeof it.unitCost === "number" ? it.unitCost : NaN))
            .filter((n: number) => Number.isFinite(n));
          if (numericCosts.length > 0) {
            averagedCost = numericCosts.reduce((s: number, n: number) => s + n, 0) / numericCosts.length;
          }
        }
        if (id) materialMap.set(id, { materialUnitCost: averagedCost, materialList: list, examples, imageUrl, notes });
      }

      const previousTotalMaterial = adjustedLines.reduce((s, l) => s + l.materialCost, 0);

      // Apply material overrides to adjustedLines with anti-spike guardrails
      for (const l of adjustedLines) {
        if (mode === "item_reprice" && requestedScopeItemId && l.scopeItemId !== requestedScopeItemId) continue;
        const m = materialMap.get(l.scopeItemId);
        const flyerMatches = flyerMatchesByScopeItem.get(l.scopeItemId) ?? [];
        const flyerPrices = flyerMatches
          .map((x) => Number(x.price))
          .filter((x) => Number.isFinite(x) && x > 0 && x < 100000);
        const flyerAvg = average(flyerPrices);
        const flyerP75 = percentile75(flyerPrices);
        if (m && typeof m.materialUnitCost === "number" && m.materialUnitCost > 0) {
          let aiMaterialUnit = m.materialUnitCost;
          if (flyerAvg && Number.isFinite(flyerAvg)) {
            // Blend LLM + local flyer evidence so flyer library materially influences deep-dive output.
            aiMaterialUnit = aiMaterialUnit * 0.7 + flyerAvg * 0.3;
          } else if (!Number.isFinite(aiMaterialUnit) || aiMaterialUnit <= 0) {
            aiMaterialUnit = flyerAvg ?? aiMaterialUnit;
          }
          const currentUnit = l.materialUnitCost > 0 ? l.materialUnitCost : 1;
          const unitLower = (l.unit ?? "").toLowerCase();
          const maxMultiplier = unitLower.includes("sqft") || unitLower.includes("sq ft")
            ? 2.2
            : unitLower.includes("lf") || unitLower.includes("linear")
              ? 2.5
              : 3.0;
          const minMultiplier = 0.35;
          const minAllowed = currentUnit * minMultiplier;
          const maxAllowed = currentUnit * maxMultiplier;
          l.materialUnitCost = clamp(aiMaterialUnit, minAllowed, maxAllowed);
          if (flyerP75 && Number.isFinite(flyerP75) && flyerP75 > 0) {
            l.materialUnitCost = Math.min(l.materialUnitCost, flyerP75 * 1.2);
          }
          if (preferredMaterialUnitCap && Number.isFinite(preferredMaterialUnitCap) && preferredMaterialUnitCap > 0) {
            // Respect deep-dive user budget/preference for material unit pricing when provided.
            l.materialUnitCost = Math.min(l.materialUnitCost, preferredMaterialUnitCap);
          }

          if (isDemolitionLike(l.task, l.segment, l.materialName ?? l.material)) {
            if (unitLower.includes("sqft") || unitLower.includes("sq ft")) {
              l.materialUnitCost = Math.min(l.materialUnitCost, 0.75);
            } else if (unitLower.includes("each") || unitLower.includes("room") || unitLower.includes("house") || unitLower.includes("set")) {
              l.materialUnitCost = Math.min(l.materialUnitCost, 95);
            } else {
              l.materialUnitCost = Math.min(l.materialUnitCost, 25);
            }
          }
          l.materialCost = (l.quantity ?? 0) * l.materialUnitCost;
          l.subtotal = (l.laborCost ?? 0) + l.materialCost;
          l.markup = l.subtotal * MARKUP_PERCENT;
          l.tax = (l.subtotal + l.markup) * (baselineResult.assumptions.taxRate ?? 0);
          l.total = l.subtotal + l.markup + l.tax;
          l.pricingSource = "user";

          const links = dedupeReferenceLinks([
            ...(m.examples ?? []).map((e) => ({
              label: e.label ?? "Supplier example",
              url: e.sourceUrl ?? "",
              price: e.price,
            })),
            ...(m.materialList ?? []).map((it) => ({
              label: it.name ?? "Material listing",
              url: it.sourceUrl ?? "",
              price: it.unitCost,
            })),
            ...flyerMatches.map((f) => ({
              label: `Flyer: ${f.name} (${f.flyer?.storeName ?? "local store"})`,
              url: f.flyer?.imageUrl ?? "",
              price: f.price,
            })),
          ])
            .filter((x) => x.url && (/^https?:\/\//.test(x.url) || x.url.startsWith("/")))
            .slice(0, 3);

          repriceReferences.push({
            scopeItemId: l.scopeItemId,
            task: l.task,
            materialUnitCost: l.materialUnitCost,
            notes: m.notes,
            links,
          });
          const flyerNote =
            flyerMatches.length > 0
              ? ` Includes ${flyerMatches.length} local flyer match(es).`
              : "";
          itemInsights[l.scopeItemId] = {
            summary: (m.notes || "AI deep-dive supplier reprice.") + flyerNote,
            links,
            imageUrl: m.imageUrl,
            updatedAt: new Date().toISOString(),
          };
        } else if (flyerMatches.length > 0 && flyerAvg && flyerAvg > 0) {
          const unitLower = (l.unit ?? "").toLowerCase();
          const currentUnit = l.materialUnitCost > 0 ? l.materialUnitCost : flyerAvg;
          const maxMultiplier = unitLower.includes("sqft") || unitLower.includes("sq ft") ? 2.2 : 3.0;
          l.materialUnitCost = clamp(flyerAvg, currentUnit * 0.35, currentUnit * maxMultiplier);
          if (preferredMaterialUnitCap && preferredMaterialUnitCap > 0) {
            l.materialUnitCost = Math.min(l.materialUnitCost, preferredMaterialUnitCap);
          }
          l.materialCost = (l.quantity ?? 0) * l.materialUnitCost;
          l.subtotal = (l.laborCost ?? 0) + l.materialCost;
          l.markup = l.subtotal * MARKUP_PERCENT;
          l.tax = (l.subtotal + l.markup) * (baselineResult.assumptions.taxRate ?? 0);
          l.total = l.subtotal + l.markup + l.tax;
          const links = dedupeReferenceLinks(
            flyerMatches.map((f) => ({
              label: `Flyer: ${f.name} (${f.flyer?.storeName ?? "local store"})`,
              url: f.flyer?.imageUrl ?? "",
              price: f.price,
            }))
          )
            .filter((x) => x.url && (/^https?:\/\//.test(x.url) || x.url.startsWith("/")))
            .slice(0, 3);
          repriceReferences.push({
            scopeItemId: l.scopeItemId,
            task: l.task,
            materialUnitCost: l.materialUnitCost,
            notes: "Repriced from local flyer library matches.",
            links,
          });
          itemInsights[l.scopeItemId] = {
            summary: `Repriced from local flyer library (${flyerMatches.length} match${flyerMatches.length > 1 ? "es" : ""}).`,
            links,
            updatedAt: new Date().toISOString(),
          };
        }
      }

      // Global safety: prevent repricing from exploding total material budget in one click.
      const repricedMaterialTotal = adjustedLines.reduce((s, l) => s + l.materialCost, 0);
      const maxAllowedTotal = previousTotalMaterial * 1.6;
      if (previousTotalMaterial > 0 && repricedMaterialTotal > maxAllowedTotal) {
        const scale = maxAllowedTotal / repricedMaterialTotal;
        for (const l of adjustedLines) {
          if (l.materialCost > 0 && l.quantity > 0) {
            l.materialUnitCost = l.materialUnitCost * scale;
            l.materialCost = l.quantity * l.materialUnitCost;
            l.subtotal = (l.laborCost ?? 0) + l.materialCost;
            l.markup = l.subtotal * MARKUP_PERCENT;
            l.tax = (l.subtotal + l.markup) * (baselineResult.assumptions.taxRate ?? 0);
            l.total = l.subtotal + l.markup + l.tax;
          }
        }
        pushLineWarning("Reprice was scaled down to avoid unrealistic material spikes.");
      }

      // Recalculate totals after reprice
      const newTotalLabor = adjustedLines.reduce((s, l) => s + l.laborCost, 0);
      const newTotalMaterial = adjustedLines.reduce((s, l) => s + l.materialCost, 0);
      const newMarkup = adjustedLines.reduce((s, l) => s + l.markup, 0);
      const newTax = adjustedLines.reduce((s, l) => s + l.tax, 0);
      const newGrand = newTotalLabor + newTotalMaterial + newMarkup + newTax;

      // overwrite totals for downstream create
      totalLabor = newTotalLabor;
      totalMaterial = newTotalMaterial;
      markup = newMarkup;
      tax = newTax;
      grandTotal = newGrand;
      pushLineWarning(
        mode === "item_reprice"
          ? "Item deep-dive repriced with Home Depot/RONA evidence."
          : "Repriced materials using Home Depot Canada / RONA evidence where available."
      );
      if (supplierHitCount === 0) {
        pushLineWarning("Web supplier search returned no strong hits for current queries.");
      }
    } catch (e) {
      // if reprice fails, continue with baseline adjustedLines
      console.error("reprice error", e);
    }
  }

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
        repriceProfile: mode === "reprice" ? repriceProfile : undefined,
        repriceReferences: mode === "reprice" || mode === "item_reprice" ? repriceReferences : undefined,
        itemInsights,
        searchEvidence: {
          provider: "openai_search",
          laborBenchmarkQueries: laborBench.searchQueries,
          laborBenchmarkHits: laborBench.searchHits,
          supplierQueries: searchSupplierQueries,
          supplierHits: searchSupplierHits,
        },
        flyerEvidence: {
          flyerItemsAvailable: flyerItems.length,
          linesMatched: flyerMatchesByScopeForEstimate.size,
        },
        fallbackPricing: {
          pricePoint,
          laborLines: fallbackLaborCount,
          materialLines: fallbackMaterialCount,
        },
        aiDebug: aiDebugSnapshot,
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
