import { NextRequest, NextResponse } from "next/server";

type CacheEntry = { data: unknown; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes
const MAX_CACHE = 500;

type PhotonLikeFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    country?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    postcode?: string;
  };
};

type NominatimResult = {
  lat: string;
  lon: string;
  address?: {
    country?: string;
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
  };
};

type GoogleAutocompleteResponse = {
  predictions?: Array<{
    place_id: string;
  }>;
};

type GooglePlaceDetailsResponse = {
  result?: {
    geometry?: { location?: { lat?: number; lng?: number } };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
    name?: string;
  };
};

function getAddressComponent(
  components: Array<{ long_name: string; short_name: string; types: string[] }>,
  type: string
) {
  return components.find((c) => c.types.includes(type));
}

async function searchGooglePlaces(query: string): Promise<PhotonLikeFeature[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];

  const autoParams = new URLSearchParams({
    input: query,
    components: "country:ca",
    key,
  });

  const autoRes = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${autoParams}`,
    { signal: AbortSignal.timeout(3500) }
  );
  if (!autoRes.ok) return [];

  const autoData = (await autoRes.json()) as GoogleAutocompleteResponse;
  const predictions = autoData.predictions ?? [];
  if (predictions.length === 0) return [];

  const topPredictions = predictions.slice(0, 6);
  const details = await Promise.all(
    topPredictions.map(async (prediction) => {
      const detailParams = new URLSearchParams({
        place_id: prediction.place_id,
        fields: "name,geometry,address_component",
        key,
      });
      const detailsRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?${detailParams}`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (!detailsRes.ok) return null;
      const data = (await detailsRes.json()) as GooglePlaceDetailsResponse;
      return data.result ?? null;
    })
  );

  return details
    .filter((result): result is NonNullable<typeof result> => !!result)
    .map((result) => {
      const components = result.address_components ?? [];
      const country = getAddressComponent(components, "country");
      const street = getAddressComponent(components, "route");
      const houseNumber = getAddressComponent(components, "street_number");
      const city =
        getAddressComponent(components, "locality")?.long_name ??
        getAddressComponent(components, "postal_town")?.long_name ??
        getAddressComponent(components, "administrative_area_level_3")?.long_name;
      const state = getAddressComponent(components, "administrative_area_level_1");
      const postcode = getAddressComponent(components, "postal_code");
      return {
        geometry: {
          coordinates: [
            result.geometry?.location?.lng ?? 0,
            result.geometry?.location?.lat ?? 0,
          ] as [number, number],
        },
        properties: {
          country: country?.long_name,
          name: result.name,
          street: street?.long_name,
          housenumber: houseNumber?.long_name,
          city,
          state: state?.short_name ?? state?.long_name,
          postcode: postcode?.long_name,
        },
      };
    })
    .filter(
      (f) =>
        f.properties.country?.toLowerCase() === "canada" &&
        (f.properties.street || f.properties.name) &&
        Number.isFinite(f.geometry.coordinates[0]) &&
        Number.isFinite(f.geometry.coordinates[1]) &&
        (f.geometry.coordinates[0] !== 0 || f.geometry.coordinates[1] !== 0)
    );
}

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
    // Primary: Google Places (better hit-rate for small/remote Canadian addresses)
    const googleFeatures = await searchGooglePlaces(q);
    if (googleFeatures.length > 0) {
      const googleResult = { features: googleFeatures };
      cache.set(cacheKey, { data: googleResult, ts: Date.now() });
      pruneCache();
      return NextResponse.json(googleResult, {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    }

    // Fallback: Photon (existing free provider)
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

    const data = await res.json() as { features?: PhotonLikeFeature[] };
    let features = (data.features ?? []).filter(
      (f) => f.properties.country === "Canada" && (f.properties.street || f.properties.name)
    );

    // Fallback for smaller/remote Canadian locations (e.g., Flin Flon)
    // where Photon may return sparse or no street-level suggestions.
    if (features.length === 0) {
      const nominatimParams = new URLSearchParams({
        q: `${q}, Canada`,
        format: "jsonv2",
        addressdetails: "1",
        limit: "6",
        countrycodes: "ca",
      });
      const fallbackRes = await fetch(`https://nominatim.openstreetmap.org/search?${nominatimParams}`, {
        headers: { "User-Agent": "AIQuotes/1.0 (contractor-tool)" },
        signal: AbortSignal.timeout(4000),
      });
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json() as NominatimResult[];
        features = fallbackData
          .filter((f) => !!f.address)
          .map((f) => ({
            geometry: { coordinates: [parseFloat(f.lon), parseFloat(f.lat)] as [number, number] },
            properties: {
              country: f.address?.country,
              street: f.address?.road,
              housenumber: f.address?.house_number,
              name: f.address?.road ?? [f.address?.town, f.address?.village, f.address?.city].filter(Boolean).join(" "),
              city: f.address?.city ?? f.address?.town ?? f.address?.village,
              state: f.address?.state,
              postcode: f.address?.postcode,
            },
          }))
          .filter((f) => f.properties.country === "Canada" && (f.properties.street || f.properties.name));
      }
    }

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
