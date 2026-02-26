type FlyerItemLike = {
  id: string;
  name: string;
  unitLabel: string | null;
  price: number;
  promoNotes: string | null;
  normalizedTokens?: unknown;
  flyer?: {
    id: string;
    storeName: string | null;
    releaseDate: Date | null;
    imageUrl: string;
  };
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "new",
  "mid",
  "range",
  "inch",
  "in",
  "ft",
  "sq",
  "per",
  "pack",
  "pcs",
  "piece",
  "pieces",
  "item",
  "install",
  "installation",
  "general",
]);

export function normalizeTokens(...inputs: Array<string | null | undefined>): string[] {
  const raw = inputs
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join(" ")
    .toLowerCase();
  const tokens = raw
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  return Array.from(new Set(tokens)).slice(0, 40);
}

export function unitHintTokens(unit: string): string[] {
  const u = (unit ?? "").toLowerCase();
  if (u.includes("sqft") || u.includes("sq ft")) return ["sqft", "floor", "tile", "sheet"];
  if (u.includes("linear")) return ["linear", "trim", "baseboard"];
  if (u.includes("sheet")) return ["sheet", "drywall"];
  if (u.includes("set")) return ["set", "bundle"];
  if (u.includes("room")) return ["room", "vanity", "fixture"];
  return [];
}

export function matchFlyerItemsForLine(
  items: FlyerItemLike[],
  line: { task: string; material?: string; materialName?: string; unit: string },
  limit = 4
): Array<FlyerItemLike & { matchScore: number }> {
  const targetTokens = normalizeTokens(line.task, line.materialName, line.material);
  const hints = unitHintTokens(line.unit);
  const withScores = items
    .map((item) => {
      const itemTokens = Array.isArray(item.normalizedTokens)
        ? (item.normalizedTokens as unknown[])
            .map((x) => String(x).toLowerCase().trim())
            .filter(Boolean)
        : normalizeTokens(item.name, item.unitLabel, item.promoNotes ?? "");
      if (itemTokens.length === 0 || targetTokens.length === 0) return null;
      const overlap = itemTokens.filter((t) => targetTokens.includes(t)).length;
      const hintOverlap = itemTokens.filter((t) => hints.includes(t)).length;
      const base = overlap / Math.max(targetTokens.length, 1);
      const score = base + (hintOverlap > 0 ? 0.2 : 0);
      if (score <= 0.05) return null;
      return { ...item, matchScore: Number(score.toFixed(4)) };
    })
    .filter((x): x is FlyerItemLike & { matchScore: number } => !!x)
    .sort((a, b) => b.matchScore - a.matchScore);
  return withScores.slice(0, limit);
}
