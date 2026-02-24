import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const province = req.nextUrl.searchParams.get("province") ?? undefined;

  if (!address.trim()) {
    return NextResponse.json({ found: false });
  }

  const coords = await geocodeAddress(address.trim(), province);
  if (coords) {
    return NextResponse.json({ found: true, lat: coords.lat, lng: coords.lng });
  }
  return NextResponse.json({ found: false });
}
