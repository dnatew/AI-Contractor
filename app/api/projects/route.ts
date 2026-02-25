import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getOrCreateUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { geocodeAddress } from "@/lib/geocode";
import { z } from "zod";

const createSchema = z.object({
  address: z.string().min(1),
  province: z.string().min(1),
  sqft: z.string().min(1),
  propertyType: z.string().optional(),
  neighborhoodTier: z.enum(["low_end", "decent", "upscale"]).optional(),
  addressDetails: z.string().optional(),
  workTypes: z.string().optional(),
  rooms: z.string().optional(),
  materialGrade: z.enum(["budget", "mid_range", "premium"]).optional(),
  notes: z.string().optional(),
  jobPrompt: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getOrCreateUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Could not resolve user" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const geocodeQuery = parsed.data.addressDetails || parsed.data.address;
  const coords = await geocodeAddress(geocodeQuery, parsed.data.province);

  const project = await prisma.project.create({
    data: {
      userId,
      ...parsed.data,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    },
  });

  return NextResponse.json(project);
}
