import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { geocodeAddress, geocodeMany, type LatLng } from "@/lib/geocode";

async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: key });
}

async function searchWeb(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return "";

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: 5,
      search_depth: "basic",
    }),
  });
  if (!res.ok) return "";

  const data = (await res.json()) as { results?: Array<{ title: string; content: string; url: string }> };
  const results = data.results ?? [];
  return results
    .map((r) => `[${r.title}] ${r.content} (${r.url})`)
    .join("\n\n");
}

const LOCAL_RADIUS_KM = 50;

function toRad(n: number) {
  return (n * Math.PI) / 180;
}

function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId ?? req.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const clarifications: Record<string, string> = body.clarifications ?? {};
  const currentPurchasePrice: number | undefined = typeof body.currentPurchasePrice === "number"
    ? body.currentPurchasePrice
    : undefined;
  const purchasePosition: "underpaid" | "fair" | "overpaid" | undefined =
    body.purchasePosition === "underpaid" || body.purchasePosition === "fair" || body.purchasePosition === "overpaid"
      ? body.purchasePosition
      : undefined;
  const userComps: Array<{
    description: string;
    price: number;
    purchasePrice?: number;
    purchaseDate?: string;
    salePrice?: number;
    saleDate?: string;
    sqft?: number;
    features: string;
    renoWork?: string;
    notes?: string;
  }> = body.userComparables ?? [];

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    include: {
      scopes: { include: { items: true } },
      estimates: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const allItems = project.scopes.flatMap((s) => s.items);
  const totalLaborHours = allItems.reduce((sum, i) => sum + (i.laborHours ?? 0), 0);

  const scopeSummary = allItems
    .map((s) => {
      let line = `${s.segment}: ${s.task} (${s.material}, ${s.quantity} ${s.unit}, ${s.laborHours ?? 0}h labor)`;
      const segKey = s.segment.toLowerCase().replace(/\s+/g, "_");
      if (clarifications[segKey]) {
        line += ` [Contractor note: ${clarifications[segKey]}]`;
      }
      return line;
    })
    .join("\n");

  const estimate = project.estimates[0];
  const quotedCost = estimate?.confirmedAmount ?? estimate?.grandTotal;

  const neighborhoodContext = project.neighborhoodTier
    ? ` Neighborhood: ${project.neighborhoodTier}.`
    : "";

  const fullAddr = project.addressDetails || project.address;
  const tierLabel = project.neighborhoodTier ? project.neighborhoodTier.replace(/_/g, " ") : "";
  const city = project.address.split(",").slice(-1)[0]?.trim() || project.address;

  const areaQuery = `homes sold ${city} ${project.province} Canada ${project.sqft} sqft recent 2024 2025`;
  const broaderQuery = `average home price ${project.province} Canada ${tierLabel || "suburban"} detached ${project.sqft} sqft`;
  const renoQuery = `renovation ROI percentage value increase Canada ${allItems.slice(0, 3).map((s) => s.task.split("—")[0].trim()).join(" ")}`;
  const [areaResults, broaderResults, renoResults] = await Promise.all([
    searchWeb(areaQuery),
    searchWeb(broaderQuery),
    searchWeb(renoQuery),
  ]);

  const searchContext = [areaResults, broaderResults, renoResults].filter(Boolean).join("\n\n---\n\n");
  const hasSearch = searchContext.length > 0;

  const clarificationText = Object.entries(clarifications)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`)
    .join("\n");

  const hasCoords = project.latitude != null && project.longitude != null;
  const coordsContext = hasCoords
    ? `\n- Exact coordinates: ${project.latitude!.toFixed(5)}, ${project.longitude!.toFixed(5)} (use this to find nearby comparables within a few km)`
    : "";

  const userCompsText = userComps.length > 0
    ? `\nCONTRACTOR'S OWN PROPERTIES & COMPARABLES (PRIMARY DATA — real transactions, trust over web results):\n${userComps.map((c, i) => {
        let line = `${i + 1}. "${c.description}"`;
        if (c.purchasePrice) line += `\n   Bought: $${c.purchasePrice.toLocaleString()} CAD${c.purchaseDate ? ` (${c.purchaseDate})` : ""}`;
        if (c.salePrice) line += `\n   Sold: $${c.salePrice.toLocaleString()} CAD${c.saleDate ? ` (${c.saleDate})` : ""}`;
        if (c.purchasePrice && c.salePrice) {
          const equity = c.salePrice - c.purchasePrice;
          line += `\n   Equity: ${equity >= 0 ? "+" : ""}$${equity.toLocaleString()} CAD`;
        }
        if (!c.purchasePrice && !c.salePrice) line += ` — $${c.price.toLocaleString()} CAD`;
        if (c.sqft) line += `\n   Size: ${c.sqft} sqft`;
        if (c.features) line += `\n   Features: ${c.features}`;
        if (c.renoWork) line += `\n   Renovation done: ${c.renoWork}`;
        if (c.notes) line += `\n   Notes: ${c.notes}`;
        return line;
      }).join("\n")}\n\n→ CRITICAL ANALYSIS INSTRUCTIONS:\n   - Properties with BOTH purchase and sale prices show REAL equity gained. This is the most valuable data.\n   - If renovation was done between purchase and sale, the equity gained = renovation impact + market appreciation.\n   - Compare properties against each other: differences in features (garage, reno, size) explain price differences.\n   - Use these REAL transactions to estimate the CURRENT project's renovation value.\n   - Include buy/sell equity calculations and feature comparisons in the "adjustments" array.\n   - Treat these user-entered properties as MORE ACTIONABLE than listing-derived renovated/unrenovated tags.\n   - In final ordering, USER properties should appear first; market-found comparables are secondary reference.`
    : "";

  const prompt = `You are a Canadian real estate analyst. Estimate the REALISTIC value impact of a renovation project.

APPROACH — VALUE ADD AS PERCENTAGE INCREASE:
The goal is to estimate what percentage this renovation raises the home's value. This is universal regardless of city pricing.
1. Every scope item is actual work. Evaluate each one's impact as a percentage of home value.
2. CANADIAN RENOVATION ROI by task type:
   - Paint / fresh walls: 100–200% ROI
   - New flooring (LVP/hardwood): 70–100% ROI
   - Baseboard & trim: 50–80% ROI
   - Kitchen cabinets refinish: 60–80% ROI
   - Full kitchen reno: 75–100% ROI
   - Full bathroom reno: 70–90% ROI
   - Tiling (floor/walls): 70–90% ROI
   - Basement finishing: 50–75% ROI
   - Electrical updates: 50–70% ROI
   - Plumbing updates: 40–60% ROI
   - Drywall / structural: value from making space usable
3. Think like a buyer: "Would I pay more for this home because of this work?"
4. Neighborhood tier affects the multiplier — upscale areas see higher lifts.

FINDING COMPARABLES — YOU MUST FIND AT LEAST 3:
Canada has very different real estate markets. You MUST identify which type this property is in and weight comparables accordingly.

MARKET TYPES (never mix them as equals):
  - RURAL: small towns, farming communities, 1K-5K pop. Prices driven by land & local economy.
  - REMOTE / NORTHERN: fly-in, mining towns, limited services. Prices reflect isolation.
  - SMALL CITY: 5K-50K pop, regional hubs.
  - CITY / SUBURBAN: 50K+ metro. Prices driven by employment & amenities.
  - RESORT / LAKEFRONT: seasonal — NEVER use as comps for standard residential.

WEIGHTING:
  - LOCAL (within 50km of the project and same market type) = 100% weight. Gold standard.
  - SAME TYPE nearby town = 70-80%. Good supporting data.
  - SAME PROVINCE, DIFFERENT type (e.g. city data for rural property) = 20-30%. Context only! A $500K city home is NOT a comp for a $150K rural home.
  - DIFFERENT PROVINCE, SAME type = 40-50%. Better than wrong type in same province.

SEARCH ORDER:
1. WITHIN 50KM: ${project.sqft} sqft homes sold within ~50km of the project
2. NEARBY SAME TYPE: other towns of the same market type in the region
3. SAME PROVINCE SAME TYPE: broader but still matched
4. CROSS-PROVINCE SAME TYPE: if rural, find other rural; if northern, find other northern
5. Filter out: lakefront, luxury, foreclosures, new builds

For EACH comparable you MUST include: full address, price, sqft, whether renovated, and a "weight" note explaining if it's LOCAL (within 50km, full weight) or REFERENCE ONLY (discounted) and why.
Include BOTH renovated and unrenovated when possible — the price gap between them IS the renovation value.
You MUST return at least 3 comparables. This is non-negotiable. Broaden as needed but ALWAYS state the weight.
${userCompsText}

PROJECT:
- Address: ${project.address}${project.addressDetails ? ` (${project.addressDetails})` : ""}
- Province: ${project.province}${coordsContext}
- Square footage: ${project.sqft} sqft
- Current purchase price: ${currentPurchasePrice && currentPurchasePrice > 0 ? `$${currentPurchasePrice.toLocaleString()} CAD` : "not provided"}
- Purchase quality vs neighbourhood: ${purchasePosition ?? "not provided"}
- Job description: ${project.jobPrompt ?? "Not specified"}
- Neighborhood: ${project.neighborhoodTier ? project.neighborhoodTier.replace(/_/g, " ") : "not specified"}

SCOPE OF WORK (${allItems.length} items, ~${totalLaborHours.toFixed(0)} total labor hours):
${scopeSummary || "No scope items yet."}

${quotedCost ? `RENOVATION COST: $${quotedCost.toFixed(0)} CAD` : ""}
${currentPurchasePrice && quotedCost ? `\n(For context: purchase + reno = $${(currentPurchasePrice + quotedCost).toLocaleString()} CAD)` : ""}

${purchasePosition ? `PURCHASE POSITION GUIDANCE:
- underpaid: entry was below neighbourhood-normal pricing. Account for extra upside and stronger margin.
- fair: entry was near market pricing. Use normal upside assumptions.
- overpaid: entry was above neighbourhood-normal pricing. Be conservative on ARV and margin; renovation may recover less than expected.

ROI ANCHOR RULE:
- If user manual flip data exists, assume the current purchase price should trend toward a similar ROI pattern as those manual flips, unless local same-size/same-feature comps strongly contradict it.` : ""}

${clarificationText ? `CONTRACTOR CLARIFICATIONS:\n${clarificationText}` : ""}

${hasSearch ? `WEB SEARCH RESULTS:\n${searchContext}` : "No web search available. Use your knowledge of Canadian markets."}

Return a JSON object:
{
  "estimatedValueAdd": number (CAD total value add),
  "estimatedPercentIncrease": number (e.g. 8.5 means 8.5%),
  "valueAddRange": [number, number] (low/high CAD),
  "percentRange": [number, number] (low/high %),
  "confidence": "high" | "medium" | "low",
  "comparablesSummary": string (2-3 sentences — reference the comparables you found, explain the value gap between renovated vs unrenovated, and how this applies to the project),
  "breakdown": [{ "renovation": string, "estimatedAdd": number, "roi": number, "notes": string }],
  "comparables": [{ "address": string (full address with city/province), "price": number (CAD), "sqft": number, "renovated": boolean, "notes": string (size, condition, year, similarity), "weight": string ("local" | "reference"), "weightReason": string (e.g. "Same town, same market type" or "Different market type — city vs rural, discounted"), "source": string ("market") }] (MINIMUM 3, up to 5),
  "adjustments": [{ "factor": string (e.g. "Garage vs no garage", "Renovated kitchen vs original"), "valueDifference": number (CAD — estimated price difference this factor makes), "notes": string }] (value adjustments calculated from comparable pairs — show the user what specific features are worth),
  "caveats": string
}

If the user provided their own comparables, use those as your anchor data and calculate value adjustments between them.
User-entered comparables are higher priority and more actionable than listing-derived assumptions.
Focus on percentage-based value add — it's universal across markets.`;

  const openai = await getOpenAI();
  // Prefer OpenAI's search model (built-in web search). Fallback to standard + Tavily.
  const searchModel = "gpt-4o-mini-search-preview";
  const fallbackModel = "gpt-4o-mini";

  let res;
  let usedSearchModel = false;
  try {
    res = await openai.chat.completions.create({
      model: searchModel,
      messages: [
        {
          role: "system",
          content:
            "You are a Canadian real estate analyst. CRITICAL WEIGHTING: local comparables (same city, same market type) = full weight. Out-of-area data = reference only, discounted by how well the market type matches (rural ≠ city ≠ remote ≠ resort). Identify the market type first, find matching comparables, state the weight for each. You MUST find at least 3. Output only valid JSON. Use CAD.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
    });
    usedSearchModel = true;
  } catch {
    res = await openai.chat.completions.create({
      model: fallbackModel,
      messages: [
        {
          role: "system",
          content:
            "You are a Canadian real estate analyst. Local comparables = full weight. Out-of-area = reference only, discounted by market type match (rural ≠ city ≠ remote ≠ resort). State the weight for each comparable. You MUST find at least 3. Output only valid JSON. Use CAD.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
    });
  }

  const text = res.choices[0]?.message?.content ?? "{}";
  let parsed: {
    estimatedValueAdd?: number;
    estimatedPercentIncrease?: number;
    valueAddRange?: [number, number];
    percentRange?: [number, number];
    confidence?: string;
    comparablesSummary?: string;
    breakdown?: Array<{ renovation: string; estimatedAdd: number; roi?: number; notes: string }>;
    comparables?: Array<{ address: string; price: number; sqft?: number; renovated?: boolean; notes: string; weight?: "local" | "reference"; weightReason?: string; source?: "market" | "user" }>;
    caveats?: string;
  };

  try {
    parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
  } catch {
    return NextResponse.json(
      { error: "Failed to parse AI response" },
      { status: 500 }
    );
  }

  // Use stored coordinates if available, otherwise geocode on the fly
  const projectCoords = (project.latitude != null && project.longitude != null)
    ? { lat: project.latitude, lng: project.longitude }
    : await geocodeAddress(project.address, project.province);

  type MapPin = { lat: number; lng: number; label: string; type: "project" | "comparable"; price?: number; sqft?: number; notes?: string };
  const mapPins: MapPin[] = [];

  if (projectCoords) {
    mapPins.push({ ...projectCoords, label: project.address, type: "project" });
  }

  if (parsed.comparables?.length) {
    const compAddresses = parsed.comparables.map((c) => c.address);
    const compCoords = await geocodeMany(compAddresses);
    const normalizedComparables = parsed.comparables.map((c) => ({ ...c }));
    for (let i = 0; i < parsed.comparables.length; i++) {
      const coords = compCoords[i];
      if (coords) {
        if (projectCoords) {
          const km = distanceKm(projectCoords, coords);
          const roundedKm = Math.round(km * 10) / 10;
          if (km <= LOCAL_RADIUS_KM) {
            normalizedComparables[i].weight = "local";
            normalizedComparables[i].weightReason = `Within ${roundedKm} km of project (<= ${LOCAL_RADIUS_KM} km local radius).`;
          } else {
            normalizedComparables[i].weight = "reference";
            normalizedComparables[i].weightReason = `${roundedKm} km from project (> ${LOCAL_RADIUS_KM} km), reference-only for context.`;
          }
        }
        mapPins.push({
          ...coords,
          label: normalizedComparables[i].address,
          type: "comparable",
          price: normalizedComparables[i].price,
          sqft: normalizedComparables[i].sqft,
          notes: normalizedComparables[i].notes,
        });
      }
    }
    parsed.comparables = normalizedComparables;
  }

  const manualComparables = userComps
    .filter((c) => (c.purchasePrice ?? 0) > 0 || (c.salePrice ?? 0) > 0 || c.price > 0)
    .map((c) => {
      const displayPrice = c.salePrice && c.salePrice > 0
        ? c.salePrice
        : c.price && c.price > 0
          ? c.price
          : c.purchasePrice ?? 0;
      const detailBits: string[] = [];
      if (c.purchasePrice) detailBits.push(`Bought ${c.purchasePrice.toLocaleString()} CAD${c.purchaseDate ? ` (${c.purchaseDate})` : ""}`);
      if (c.salePrice) detailBits.push(`Sold ${c.salePrice.toLocaleString()} CAD${c.saleDate ? ` (${c.saleDate})` : ""}`);
      if (c.renoWork) detailBits.push(`Reno: ${c.renoWork}`);
      return {
        address: c.description || "User comparable",
        price: displayPrice,
        sqft: c.sqft,
        renovated: c.salePrice != null && c.purchasePrice != null ? true : undefined,
        notes: detailBits.join(" · ") || "Manual user-entered flip data",
        weight: "local" as const,
        weightReason: "User-entered real flip data (highest priority actionable input).",
        source: "user" as const,
      };
    });

  const marketComparables = (parsed.comparables ?? []).map((c) => ({
    ...c,
    source: c.source ?? ("market" as const),
  }));

  const mergedComparables = [...manualComparables, ...marketComparables];
  if (mergedComparables.length > 0) {
    parsed.comparables = mergedComparables;
  }

  return NextResponse.json({
    ...parsed,
    usedWebSearch: usedSearchModel || hasSearch,
    mapPins,
  });
}
