import { NextRequest, NextResponse } from "next/server";

type CacheEntry = { data: unknown; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes
const MAX_CACHE = 500;

function pruneCache() {
  if (cache.size <= MAX_CACHE) return;
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
  if (cache.size > MAX_CACHE) {
    const keys = Array.from(cache.keys());
    for (let i = 0; i < keys.length - MAX_CACHE; i++) cache.delete(keys[i]);
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ features: [] });
  }

  const cacheKey = q.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  try {
    const params = new URLSearchParams({
      q,
      limit: "6",
      lang: "en",
      bbox: "-141.0,41.7,-52.6,83.1",
    });
    const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return NextResponse.json({ features: [] });
    }

    const data = await res.json();
    const features = (data.features ?? []).filter(
      (f: { properties: { country?: string; street?: string; name?: string } }) =>
        f.properties.country === "Canada" && (f.properties.street || f.properties.name)
    );

    const result = { features };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    pruneCache();

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json({ features: [] });
  }
}
