import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

function parseDateInput(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const flyer = await prisma.flyer.findFirst({ where: { id, userId } });
  if (!flyer) {
    return NextResponse.json({ error: "Flyer not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const releaseDate =
    typeof body.releaseDate === "string" ? parseDateInput(body.releaseDate) : undefined;
  const updated = await prisma.flyer.update({
    where: { id },
    data: {
      ...(body.storeName != null && { storeName: String(body.storeName).trim() || null }),
      ...(body.parsedSummary != null && {
        parsedSummary: String(body.parsedSummary).trim() || null,
      }),
      ...(body.releaseDate != null && { releaseDate: releaseDate ?? null }),
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const flyer = await prisma.flyer.findFirst({ where: { id, userId }, select: { id: true } });
  if (!flyer) {
    return NextResponse.json({ error: "Flyer not found" }, { status: 404 });
  }

  await prisma.flyer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
