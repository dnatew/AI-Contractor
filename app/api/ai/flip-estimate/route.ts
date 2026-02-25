import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: key });
}

const VALUE_RANGE_MAP: Record<string, string> = {
  under_150k: "under $150,000",
  "150k_300k": "$150,000 – $300,000",
  "300k_500k": "$300,000 – $500,000",
  "500k_750k": "$500,000 – $750,000",
  "750k_1m": "$750,000 – $1,000,000",
  over_1m: "over $1,000,000",
};

const MARKET_MAP: Record<string, string> = {
  buyers: "buyer's market (slow sales, lots of inventory)",
  balanced: "balanced market",
  sellers: "seller's market (fast sales, bidding wars, low inventory)",
  unknown: "market conditions unknown",
};

type PropInput = {
  description: string;
  purchasePrice?: number;
  purchaseDate?: string;
  salePrice?: number;
  saleDate?: string;
  sqft?: number;
  features?: string;
  renoWork?: string;
};

function computeROIStats(props: PropInput[], renoCostHint: number) {
  const deals = props.filter((p) => (p.purchasePrice ?? 0) > 0 && (p.salePrice ?? 0) > 0);
  if (deals.length === 0) return null;

  const rois: number[] = [];
  const equities: number[] = [];
  const pctGains: number[] = [];

  for (const d of deals) {
    const buy = d.purchasePrice!;
    const sell = d.salePrice!;
    const equity = sell - buy;
    equities.push(equity);
    pctGains.push(((sell - buy) / buy) * 100);
    if (renoCostHint > 0) {
      rois.push((equity / renoCostHint) * 100);
    }
  }

  const avgEquity = equities.reduce((a, b) => a + b, 0) / equities.length;
  const avgPctGain = pctGains.reduce((a, b) => a + b, 0) / pctGains.length;
  const avgROI = rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : null;

  return {
    dealCount: deals.length,
    avgEquity: Math.round(avgEquity),
    avgPctGain: Math.round(avgPctGain * 10) / 10,
    avgROI: avgROI !== null ? Math.round(avgROI * 10) / 10 : null,
    minEquity: Math.min(...equities),
    maxEquity: Math.max(...equities),
    deals: deals.map((d) => ({
      description: d.description,
      buy: d.purchasePrice!,
      sell: d.salePrice!,
      equity: d.salePrice! - d.purchasePrice!,
      pctGain: Math.round(((d.salePrice! - d.purchasePrice!) / d.purchasePrice!) * 1000) / 10,
    })),
  };
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId;
  const userContext = body.userContext ?? {};
  const realEstateContext: {
    savedAt?: string;
    estimatedValueAdd?: number;
    estimatedPercentIncrease?: number;
    comparablesSummary?: string;
    comparables?: Array<{ address: string; price: number; sqft?: number; renovated?: boolean; notes?: string; weight?: "local" | "reference"; weightReason?: string }>;
  } | undefined = body.realEstateContext;
  let userProperties: PropInput[] = body.userProperties ?? [];

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
      scopes: { include: { items: true } },
      estimates: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (userProperties.length === 0) {
    const dbProps = await prisma.userProperty.findMany({
      where: { userId },
    });
    userProperties = dbProps.map((p) => ({
      description: p.description,
      purchasePrice: p.purchasePrice || undefined,
      purchaseDate: p.purchaseDate || undefined,
      salePrice: p.salePrice || undefined,
      saleDate: p.saleDate || undefined,
      sqft: p.sqft || undefined,
      features: p.features || undefined,
      renoWork: p.renoWork || undefined,
    }));
  }

  const allItems = project.scopes.flatMap((s) => s.items);
  const estimate = project.estimates[0];
  const renoCost = estimate?.confirmedAmount ?? estimate?.grandTotal ?? 0;

  const scopeSummary = allItems
    .map((s) => `${s.segment}: ${s.task} (${s.material}, ${s.quantity} ${s.unit})`)
    .join("\n");

  const localValueLabel = VALUE_RANGE_MAP[userContext.localValueRange] ?? "not specified";
  const marketLabel = MARKET_MAP[userContext.marketCondition] ?? "not specified";
  const experienceLabel = userContext.hasSoldBefore === true
    ? "Yes, they know the local market"
    : userContext.hasSoldBefore === false
      ? "No, first time in this area"
      : "Not specified";
  const purchasePosition = userContext.purchasePosition === "underpaid" || userContext.purchasePosition === "fair" || userContext.purchasePosition === "overpaid"
    ? userContext.purchasePosition
    : undefined;
  const purchasePositionLabel = purchasePosition === "underpaid"
    ? "underpaid vs neighbourhood (bought below local market)"
    : purchasePosition === "overpaid"
      ? "overpaid vs neighbourhood (bought above local market)"
      : purchasePosition === "fair"
        ? "paid fair market"
        : "not specified";

  const roiStats = computeROIStats(userProperties, renoCost);

  const roiPatternBlock = roiStats
    ? `
CONTRACTOR'S TRACK RECORD (${roiStats.dealCount} completed deal${roiStats.dealCount > 1 ? "s" : ""}):
${roiStats.deals.map((d) => `- ${d.description}: Bought $${d.buy.toLocaleString()} → Sold $${d.sell.toLocaleString()} = +$${d.equity.toLocaleString()} (+${d.pctGain}%)`).join("\n")}

PATTERN ANALYSIS:
- Average equity gained per deal: $${roiStats.avgEquity.toLocaleString()}
- Average price increase: ${roiStats.avgPctGain}%
${roiStats.avgROI !== null ? `- Average ROI on reno cost: ${roiStats.avgROI}%` : ""}
- Equity range: $${roiStats.minEquity.toLocaleString()} to $${roiStats.maxEquity.toLocaleString()}

CRITICAL RULE — HISTORICAL ROI IS THE STRONGEST PREDICTOR:
If this contractor has done flips before and averaged ${roiStats.avgPctGain}% price gain (or ${roiStats.avgROI !== null ? `${roiStats.avgROI}% ROI on reno cost` : "strong equity"}), the next similar flip will MOST LIKELY follow the same pattern. A contractor who consistently gets 250% ROI on reno cost will keep getting similar results because they know their market, their costs, and their buyers.
Use their historical ROI pattern as the PRIMARY basis for ARV estimation:
  → suggestedARVRange should reflect: purchasePrice + (renoCost × historical ROI multiplier) ± some margin
This is MORE RELIABLE than online comparables for an experienced contractor.`
    : "";

  const propsBlock = userProperties.length > 0
    ? `
CONTRACTOR'S OWN PROPERTIES (PRIMARY reference data):
${userProperties.map((p, i) => {
  const parts = [`${i + 1}. ${p.description || "Unnamed property"}`];
  if (p.sqft) parts.push(`   ${p.sqft} sqft`);
  if (p.purchasePrice) parts.push(`   Purchased: $${p.purchasePrice.toLocaleString()}${p.purchaseDate ? ` (${p.purchaseDate})` : ""}`);
  if (p.salePrice) parts.push(`   Sold: $${p.salePrice.toLocaleString()}${p.saleDate ? ` (${p.saleDate})` : ""}`);
  if (p.features) parts.push(`   Features: ${p.features}`);
  if (p.renoWork) parts.push(`   Reno work done: ${p.renoWork}`);
  return parts.join("\n");
}).join("\n\n")}`
    : "";

  const prompt = `You are a Canadian real estate flip advisor helping a contractor estimate a deal.

ROLE: You are an ADVISOR, not an appraiser. The contractor knows their market better than online data.

COMPARABLE SEARCH — WEIGHTING & MARKET TYPES:
Canada has very different real estate markets. You MUST understand which type you're dealing with and weight comparables accordingly.

MARKET TYPES (each behaves differently — never mix them as equals):
  - RURAL: small towns, farming communities, 1K-5K population. Prices driven by land, local economy. Very different from cities.
  - REMOTE / NORTHERN: fly-in communities, mining towns, limited services. Prices reflect isolation and supply.
  - SMALL CITY: 5K-50K population, regional hubs. Prices higher than rural but still well below major cities.
  - CITY / SUBURBAN: 50K+ metro areas. Prices driven by employment, amenities, transit.
  - RESORT / LAKEFRONT: seasonal properties. Prices are NOT comparable to standard residential — NEVER use these as comps for a normal home flip.

WEIGHTING RULES:
  - LOCAL comparables (same city/town, same market type) = WEIGHT 100%. These are the gold standard.
  - SAME MARKET TYPE in a nearby town (e.g. another similar small town 30-100km away) = WEIGHT 70-80%. Useful reference.
  - SAME PROVINCE but DIFFERENT market type (e.g. city data for a rural property) = WEIGHT 20-30%. Use ONLY for general context, NOT for pricing. A $500K Winnipeg home is irrelevant to a $150K rural Manitoba home.
  - DIFFERENT PROVINCE, same market type = WEIGHT 40-50%. Better than wrong market type in same province.
  - NEVER treat out-of-area comparables as equal to local ones. Always discount them and explain the gap.

SEARCH ORDER:
1. LOCAL FIRST: Same city/town, similar size. Highest weight.
2. NEARBY SAME TYPE: Other towns of the same market type in the region. Good supporting data.
3. SAME PROVINCE SAME TYPE: Broader, but still matched by market type.
4. CROSS-PROVINCE SAME TYPE: If rural, find other rural. If northern, find other northern.
5. Filter out: lakefront, luxury, foreclosures, new builds — these skew averages badly.

When reporting, ALWAYS state which comparables are local vs. reference-only and how you weighted them.

${propsBlock}
${roiPatternBlock}

PROPERTY BEING EVALUATED:
- Address: ${project.address}${project.addressDetails ? ` (${project.addressDetails})` : ""}
- Province: ${project.province}
- Square footage: ${project.sqft} sqft
- Property type: ${project.propertyType ?? "residential"}
- Neighborhood tier: ${project.neighborhoodTier ? project.neighborhoodTier.replace(/_/g, " ") : "not specified"}

RENOVATION: ${allItems.length} scope items, estimated cost $${renoCost.toLocaleString()} CAD
${scopeSummary || "No scope items specified."}

CONTRACTOR'S LOCAL KNOWLEDGE:
- Typical home values in this area: ${localValueLabel}
- Current market conditions: ${marketLabel}
- Has sold/bought here before: ${experienceLabel}
- Purchase position: ${purchasePositionLabel}
${userContext.userNotes ? `- Contractor notes: "${userContext.userNotes}"` : ""}
${userContext.currentPurchasePrice ? `- They've entered a purchase price: $${userContext.currentPurchasePrice.toLocaleString()}` : ""}
${userContext.currentSalePrice ? `- They've entered a target sale price: $${userContext.currentSalePrice.toLocaleString()}` : ""}

${realEstateContext ? `LATEST REAL ESTATE TAB OUTPUT (use as carryover context):
- Saved at: ${realEstateContext.savedAt ?? "unknown"}
${realEstateContext.estimatedValueAdd != null ? `- Estimated value add: $${realEstateContext.estimatedValueAdd.toLocaleString()} CAD` : ""}
${realEstateContext.estimatedPercentIncrease != null ? `- Estimated percent increase: ${realEstateContext.estimatedPercentIncrease}%` : ""}
${realEstateContext.comparablesSummary ? `- Summary: ${realEstateContext.comparablesSummary}` : ""}
${realEstateContext.comparables?.length ? `- Top comparables:\n${realEstateContext.comparables.slice(0, 5).map((c, i) => {
  const bits = [`  ${i + 1}. ${c.address} — $${c.price.toLocaleString()}`];
  if (c.sqft) bits.push(` (${c.sqft} sqft)`);
  if (c.weight) bits.push(` [${c.weight}]`);
  if (c.weightReason) bits.push(` ${c.weightReason}`);
  return bits.join("");
}).join("\n")}` : ""}` : ""}

ESTIMATION LOGIC:
1. If the contractor has completed deals with buy/sell data → use their HISTORICAL ROI PATTERN as the strongest predictor. Their past performance is more predictive than web data.
2. If no past deals → use online comparables from the search priority above, anchored to the contractor's stated local value range.
3. Renovation value-add should be estimated from the scope of work, but weighted by the contractor's historical results if available.
4. For ARV: if contractor averages X% gain on similar deals, apply that same pattern here. An experienced flipper who consistently gains $60K on a $25K reno will likely repeat that.
5. Respect purchase position: if they underpaid, allow stronger upside; if they overpaid, reduce expected margin and be conservative even if comps look strong.
6. If Real Estate tab output is provided, treat it as already-curated comparable intelligence and use it before starting fresh web assumptions.
7. Prioritize USER-ENTERED manual properties over listing-derived renovated/unrenovated labels; user flips are real, actionable data.
8. Assume current purchase price will usually land near the ROI behavior of manual user flips unless same-size/same-feature local comps clearly contradict it.

Return a JSON object:
{
  "suggestedPurchaseRange": [number, number],
  "suggestedARVRange": [number, number],
  "suggestedHoldingMonths": number,
  "monthlyHoldingCost": number,
  "reasoning": string (3-5 sentences: explain what data you found, explicitly state which comparables are LOCAL vs reference-only, how you weighted them, mention their track record if applicable),
  "caution": string | null (warn if online data is from a different market type, sparse, or skewed by outlier properties; null if confident),
  "comparablesFound": string | null (brief summary: "Local: [town] $X-$Y | Reference: [other town] $X-$Y (different market, weighted lower)"),
  "marketType": string ("rural" | "remote" | "small_city" | "city" | "suburban")
}

RULES:
- Anchor to the contractor's stated value range. If they say $150K–$300K, stay in that band.
- If they have past deals showing strong ROI, reflect that pattern in suggestedARVRange.
- ALWAYS identify the market type and only use matching-type comparables at full weight.
- If the only data you find is from a DIFFERENT market type, say so clearly and discount it.
- Return ONLY valid JSON, no markdown.`;

  const openai = await getOpenAI();

  let res;
  try {
    res = await openai.chat.completions.create({
      model: "gpt-4o-mini-search-preview",
      messages: [
        {
          role: "system",
          content: `You are a Canadian real estate flip advisor. CRITICAL: local comparables carry FULL weight, out-of-area data is reference only (20-50% weight depending on market type match). Rural ≠ city ≠ remote ≠ resort. Identify the market type first, then search for matching comparables. Contractor's own deal history is the strongest ROI predictor. Output only valid JSON. All prices in CAD.`,
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
    });
  } catch {
    res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a Canadian real estate flip advisor. Local comparables = full weight. Out-of-area = reference only, discounted by market type match. Rural ≠ city ≠ remote. Contractor's deal history is the strongest predictor. Output only valid JSON. All prices in CAD.`,
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
    });
  }

  const text = res.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
    if (roiStats) {
      parsed.roiPattern = {
        dealCount: roiStats.dealCount,
        avgPctGain: roiStats.avgPctGain,
        avgROI: roiStats.avgROI,
        avgEquity: roiStats.avgEquity,
      };
    }
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
  }
}
