export type PricePoint = "low" | "medium" | "high";

type TieredRate = { low: number; medium: number; high: number };

const LABOR_SQFT_BY_CATEGORY: Record<string, TieredRate> = {
  painting: { low: 1.4, medium: 2.2, high: 3.3 },
  drywall: { low: 1.2, medium: 1.9, high: 2.8 },
  flooring: { low: 2.1, medium: 3.2, high: 4.8 },
  tiling: { low: 4.0, medium: 6.0, high: 8.5 },
  demolition: { low: 1.1, medium: 1.8, high: 2.9 },
  kitchen: { low: 4.2, medium: 6.8, high: 10.5 },
  bathroom: { low: 4.8, medium: 7.5, high: 11.5 },
  general: { low: 1.8, medium: 2.9, high: 4.4 },
};

const MATERIAL_UNIT_FALLBACKS: Array<{ keywords: RegExp; rates: TieredRate }> = [
  { keywords: /\b(paint|primer)\b/i, rates: { low: 0.35, medium: 0.6, high: 1.05 } }, // sqft
  { keywords: /\b(drywall|taping|mud)\b/i, rates: { low: 0.45, medium: 0.85, high: 1.4 } }, // sqft
  { keywords: /\b(vinyl|laminate|lvp|lvt|hardwood|floor)\b/i, rates: { low: 1.4, medium: 2.2, high: 3.4 } }, // sqft
  { keywords: /\b(tile|porcelain|ceramic|backsplash)\b/i, rates: { low: 2.4, medium: 3.9, high: 6.0 } }, // sqft
  { keywords: /\b(trim|baseboard|casing)\b/i, rates: { low: 1.8, medium: 3.2, high: 5.5 } }, // lf
  { keywords: /\b(counter|countertop)\b/i, rates: { low: 180, medium: 320, high: 620 } }, // each
  { keywords: /\b(vanity|sink|toilet|faucet)\b/i, rates: { low: 95, medium: 180, high: 340 } }, // each
  { keywords: /\b(cabinet|door|hardware)\b/i, rates: { low: 120, medium: 240, high: 460 } }, // each
];

function rateForPoint(rate: TieredRate, point: PricePoint): number {
  return point === "low" ? rate.low : point === "high" ? rate.high : rate.medium;
}

function normalizeCategory(category: string): string {
  const c = category.toLowerCase().trim();
  if (!c) return "general";
  if (c.includes("paint")) return "painting";
  if (c.includes("drywall") || c.includes("taping")) return "drywall";
  if (c.includes("floor")) return "flooring";
  if (c.includes("tile")) return "tiling";
  if (c.includes("demo")) return "demolition";
  if (c.includes("kitchen")) return "kitchen";
  if (c.includes("bath")) return "bathroom";
  return "general";
}

export function getFallbackLaborSqftRate(category: string, point: PricePoint): number {
  const key = normalizeCategory(category);
  const rates = LABOR_SQFT_BY_CATEGORY[key] ?? LABOR_SQFT_BY_CATEGORY.general;
  return rateForPoint(rates, point);
}

export function getFallbackMaterialUnitCost(
  task: string,
  material: string,
  unit: string,
  point: PricePoint
): number | null {
  const text = `${task} ${material}`.toLowerCase();
  const u = unit.toLowerCase();
  const match = MATERIAL_UNIT_FALLBACKS.find((x) => x.keywords.test(text));
  if (!match) return null;
  const base = rateForPoint(match.rates, point);

  if (u.includes("sqft") || u.includes("sq ft")) return base;
  if (u.includes("lf") || u.includes("linear")) return Math.max(1.2, base);
  if (u.includes("each") || u.includes("set") || u.includes("room")) return Math.max(30, base);
  if (u.includes("house")) return Math.max(250, base * 120);
  return base;
}
