import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { geocodeAddress } from "@/lib/geocode";
import { z } from "zod";

const updateSchema = z.object({
  address: z.string().min(1).optional(),
  province: z.string().min(1).optional(),
  sqft: z.string().min(1).optional(),
  propertyType: z.string().optional().nullable(),
  neighborhoodTier: z.enum(["low_end", "decent", "upscale"]).optional().nullable(),
  addressDetails: z.string().optional().nullable(),
  workTypes: z.string().optional().nullable(),
  rooms: z.string().optional().nullable(),
  materialGrade: z.enum(["budget", "mid_range", "premium"]).optional().nullable(),
  notes: z.string().optional().nullable(),
  jobPrompt: z.string().optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.address != null) data.address = parsed.data.address;
  if (parsed.data.province != null) data.province = parsed.data.province;
  if (parsed.data.sqft != null) data.sqft = parsed.data.sqft;
  if (parsed.data.propertyType !== undefined) data.propertyType = parsed.data.propertyType;
  if (parsed.data.neighborhoodTier !== undefined) data.neighborhoodTier = parsed.data.neighborhoodTier;
  if (parsed.data.addressDetails !== undefined) data.addressDetails = parsed.data.addressDetails;
  if (parsed.data.workTypes !== undefined) data.workTypes = parsed.data.workTypes;
  if (parsed.data.rooms !== undefined) data.rooms = parsed.data.rooms;
  if (parsed.data.materialGrade !== undefined) data.materialGrade = parsed.data.materialGrade;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.jobPrompt !== undefined) data.jobPrompt = parsed.data.jobPrompt;

  const addressChanged = parsed.data.address !== undefined || parsed.data.addressDetails !== undefined;
  if (addressChanged) {
    const newAddress = (parsed.data.addressDetails ?? parsed.data.address ?? project.addressDetails ?? project.address);
    const newProvince = parsed.data.province ?? project.province;
    const coords = await geocodeAddress(newAddress, newProvince);
    data.latitude = coords?.lat ?? null;
    data.longitude = coords?.lng ?? null;
  }

  const updated = await prisma.project.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}
