export type ProvinceCode = string;

export interface ProvincePricing {
  laborRatePerHour: number;
  materialMultiplier: number;
  taxRate: number;
  taxName: string;
}

export const PROVINCE_PRICING: Record<ProvinceCode, ProvincePricing> = {
  ON: { laborRatePerHour: 55, materialMultiplier: 1.05, taxRate: 0.13, taxName: "HST" },
  BC: { laborRatePerHour: 52, materialMultiplier: 1.08, taxRate: 0.12, taxName: "GST+PST" },
  AB: { laborRatePerHour: 50, materialMultiplier: 1.0, taxRate: 0.05, taxName: "GST" },
  QC: { laborRatePerHour: 48, materialMultiplier: 1.03, taxRate: 0.14975, taxName: "QST+GST" },
  SK: { laborRatePerHour: 45, materialMultiplier: 0.98, taxRate: 0.11, taxName: "GST+PST" },
  MB: { laborRatePerHour: 46, materialMultiplier: 0.99, taxRate: 0.12, taxName: "GST+PST" },
  NS: { laborRatePerHour: 48, materialMultiplier: 1.02, taxRate: 0.15, taxName: "HST" },
  NB: { laborRatePerHour: 47, materialMultiplier: 1.01, taxRate: 0.15, taxName: "HST" },
  NL: { laborRatePerHour: 46, materialMultiplier: 1.04, taxRate: 0.15, taxName: "HST" },
  PE: { laborRatePerHour: 47, materialMultiplier: 1.02, taxRate: 0.15, taxName: "HST" },
  NT: { laborRatePerHour: 65, materialMultiplier: 1.25, taxRate: 0.05, taxName: "GST" },
  NU: { laborRatePerHour: 70, materialMultiplier: 1.3, taxRate: 0.05, taxName: "GST" },
  YT: { laborRatePerHour: 58, materialMultiplier: 1.15, taxRate: 0.05, taxName: "GST" },
};

export const MATERIAL_BASELINE: Record<string, number> = {
  "vinyl plank": 4.5,
  "luxury vinyl plank": 6.0,
  "lvt": 6.0,
  "laminate": 3.5,
  "hardwood": 12.0,
  "engineered hardwood": 8.0,
  "tile": 7.0,
  "ceramic tile": 7.0,
  "porcelain tile": 9.0,
  "marble tile": 18.0,
  "underlayment": 0.8,
  "transition strips": 15,
  "baseboard": 3.5,
  "subfloor": 2.5,
  "paint": 0.5,
  "primer": 0.3,
  "drywall sheet": 14,
  "drywall compound": 0.4,
  default: 5.0,
};

function matchMaterialCost(
  material: string,
  userMaterials?: Record<string, { rate: number; unit: string }>
): { cost: number; source: "user" | "default"; matchedName: string } {
  const lower = material.toLowerCase();

  if (userMaterials) {
    for (const [name, data] of Object.entries(userMaterials)) {
      if (lower.includes(name) || name.includes(lower)) {
        return { cost: data.rate, source: "user", matchedName: name };
      }
    }
  }

  for (const [key, cost] of Object.entries(MATERIAL_BASELINE)) {
    if (key === "default") continue;
    if (lower.includes(key)) {
      return { cost, source: "default", matchedName: key };
    }
  }

  return { cost: MATERIAL_BASELINE.default, source: "default", matchedName: "general" };
}

function inferPricingKey(task: string, material: string, unit: string): string | null {
  const t = task.toLowerCase();
  const m = material.toLowerCase();
  const u = unit.toLowerCase();
  if (u.includes("sqft") || u === "sq ft") {
    if (/\b(floor|vinyl|laminate|lvp|lvt|hardwood|plank)\b/.test(t + " " + m)) return "flooring_sqft";
    if (/\b(wall|paint|drywall)\b/.test(t + " " + m) && !/\btap(e|ing)\b/.test(t)) return "walls_sqft";
    if (/\b(tile|tiling)\b/.test(t + " " + m)) return "tiling_sqft";
    if (/\b(drywall|tap(e|ing)|mud)\b/.test(t + " " + m)) return "drywall_taping_sqft";
  }
  return null;
}

export interface LineItemCost {
  scopeItemId: string;
  segment: string;
  task: string;
  material: string;
  quantity: number;
  unit: string;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  materialUnitCost: number;
  materialName: string;
  materialCost: number;
  pricingSource: "user" | "default";
  subtotal: number;
  markup: number;
  tax: number;
  total: number;
}

export interface EstimateResult {
  lines: LineItemCost[];
  totalLabor: number;
  totalMaterial: number;
  subtotal: number;
  markup: number;
  totalBeforeTax: number;
  tax: number;
  grandTotal: number;
  assumptions: {
    province: string;
    laborRate: number;
    materialMultiplier: number;
    taxRate: number;
    taxName: string;
    markupPercent: number;
  };
}

const MARKUP_PERCENT = 0.15;

export type UserPricingMap = Record<string, { rate: number; unit: string }>;

export function computeEstimate(
  province: ProvinceCode,
  scopeItems: Array<{
    id: string;
    segment: string;
    task: string;
    material: string;
    quantity: number;
    unit: string;
    laborHours: number | null;
  }>,
  userPricing?: UserPricingMap
): EstimateResult {
  const pricing = PROVINCE_PRICING[province] ?? PROVINCE_PRICING.ON;
  const { laborRatePerHour, materialMultiplier, taxRate } = pricing;

  const userMaterials: Record<string, { rate: number; unit: string }> = {};
  if (userPricing) {
    for (const [k, v] of Object.entries(userPricing)) {
      if (k.startsWith("mat:")) {
        userMaterials[k.slice(4)] = v;
      }
    }
  }

  const lines: LineItemCost[] = scopeItems.map((item) => {
    const key = inferPricingKey(item.task, item.material, item.unit);
    const userRate = userPricing && key ? userPricing[key] : null;

    let laborCost: number;
    let materialCost: number;
    let laborHours: number;
    let materialUnitCost: number;
    let materialName: string;
    let pricingSource: "user" | "default";
    const effectiveLaborRate = laborRatePerHour;

    const useUserRate = userRate && (
      userRate.unit === item.unit ||
      (userRate.unit.includes("sqft") && item.unit.toLowerCase().includes("sqft"))
    );

    if (useUserRate) {
      const totalFromUser = item.quantity * userRate.rate;
      laborCost = totalFromUser * 0.6;
      materialCost = totalFromUser * 0.4;
      laborHours = laborCost / laborRatePerHour;
      materialUnitCost = (userRate.rate * 0.4);
      materialName = item.material || "included in rate";
      pricingSource = "user";
    } else {
      const matched = matchMaterialCost(item.material, userMaterials);
      materialUnitCost = matched.cost * (matched.source === "default" ? materialMultiplier : 1);
      materialName = matched.matchedName;
      pricingSource = matched.source;
      materialCost = item.quantity * materialUnitCost;
      laborHours = item.laborHours ?? item.quantity / 50;
      laborCost = laborHours * laborRatePerHour;
    }

    const subtotal = laborCost + materialCost;
    const markup = subtotal * MARKUP_PERCENT;
    const totalBeforeTax = subtotal + markup;
    const tax = totalBeforeTax * taxRate;
    const total = totalBeforeTax + tax;

    return {
      scopeItemId: item.id,
      segment: item.segment,
      task: item.task,
      material: item.material,
      quantity: item.quantity,
      unit: item.unit,
      laborHours,
      laborRate: effectiveLaborRate,
      laborCost,
      materialUnitCost,
      materialName,
      materialCost,
      pricingSource,
      subtotal,
      markup,
      tax,
      total,
    };
  });

  const totalLabor = lines.reduce((s, l) => s + l.laborCost, 0);
  const totalMaterial = lines.reduce((s, l) => s + l.materialCost, 0);
  const subtotal = totalLabor + totalMaterial;
  const markup = lines.reduce((s, l) => s + l.markup, 0);
  const totalBeforeTax = subtotal + markup;
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  const grandTotal = totalBeforeTax + tax;

  return {
    lines,
    totalLabor,
    totalMaterial,
    subtotal,
    markup,
    totalBeforeTax,
    tax,
    grandTotal,
    assumptions: {
      province,
      laborRate: laborRatePerHour,
      materialMultiplier,
      taxRate,
      taxName: pricing.taxName,
      markupPercent: MARKUP_PERCENT * 100,
    },
  };
}
