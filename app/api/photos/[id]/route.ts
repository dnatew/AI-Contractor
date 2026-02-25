import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const photo = await prisma.photo.findUnique({
    where: { id },
    include: { project: true },
  });

  if (!photo || photo.project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.roomLabel === "string") data.roomLabel = body.roomLabel || null;
  if (typeof body.userNotes === "string") data.userNotes = body.userNotes || null;

  const updated = await prisma.photo.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}
