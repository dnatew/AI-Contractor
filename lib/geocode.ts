export type LatLng = { lat: number; lng: number };

const PROVINCE_ABBRS = new Set([
  "ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt",
  "alberta", "british columbia", "manitoba", "new brunswick",
  "newfoundland", "nova scotia", "ontario", "prince edward island",
  "quebec", "saskatchewan", "northwest territories", "nunavut", "yukon",
]);

function addressLooksComplete(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.includes("canada")) return true;
  const parts = lower.split(/[,\s]+/);
  return parts.some((p) => PROVINCE_ABBRS.has(p));
}

/**
 * Geocode an address using OpenStreetMap Nominatim (free, no API key).
 * If the address already contains province/city info, it's used as-is.
 * Falls back to appending province hint only when the address looks incomplete.
 */
export async function geocodeAddress(
  address: string,
  province?: string
): Promise<LatLng | null> {
  const alreadyComplete = addressLooksComplete(address);
  const q = alreadyComplete
    ? `${address}, Canada`
    : province
      ? `${address}, ${province}, Canada`
      : `${address}, Canada`;

  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q,
    format: "json",
    limit: "1",
    countrycodes: "ca",
  })}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AIQuotes/1.0 (contractor-tool)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) {
      if (!alreadyComplete && province) {
        return geocodeAddress(address);
      }
      return null;
    }
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

/**
 * Geocode multiple addresses concurrently in batches of 2 to respect
 * Nominatim's usage policy while being faster than fully sequential.
 * Does NOT force the project province — each address is geocoded on its own
 * so comparables from neighbouring provinces resolve correctly.
 */
export async function geocodeMany(
  addresses: string[],
  _province?: string
): Promise<(LatLng | null)[]> {
  const results: (LatLng | null)[] = new Array(addresses.length).fill(null);
  const BATCH = 2;
  for (let i = 0; i < addresses.length; i += BATCH) {
    const batch = addresses.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map((addr) => geocodeAddress(addr))
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
    if (i + BATCH < addresses.length) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }
  return results;
}
