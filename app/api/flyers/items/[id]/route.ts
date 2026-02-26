import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeTokens } from "@/lib/flyers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const item = await prisma.flyerItem.findFirst({
    where: { id, flyer: { userId } },
    include: { flyer: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Flyer item not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const nextName = body.name != null ? String(body.name).trim() : item.name;
  const nextUnitLabel =
    body.unitLabel != null ? String(body.unitLabel).trim() || null : item.unitLabel;
  const nextPromoNotes =
    body.promoNotes != null ? String(body.promoNotes).trim() || null : item.promoNotes;
  const nextRawText = body.rawText != null ? String(body.rawText).trim() || null : item.rawText;
  const nextPrice =
    body.price != null && Number.isFinite(Number(body.price)) ? Number(body.price) : item.price;
  if (!nextName || !(nextPrice > 0)) {
    return NextResponse.json(
      { error: "name and positive numeric price are required" },
      { status: 400 }
    );
  }

  const updated = await prisma.flyerItem.update({
    where: { id },
    data: {
      name: nextName,
      unitLabel: nextUnitLabel,
      price: Number(nextPrice.toFixed(2)),
      promoNotes: nextPromoNotes,
      rawText: nextRawText,
      normalizedTokens: normalizeTokens(nextName, nextUnitLabel, nextPromoNotes, nextRawText),
    },
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
  const item = await prisma.flyerItem.findFirst({
    where: { id, flyer: { userId } },
    select: { id: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Flyer item not found" }, { status: 404 });
  }
  await prisma.flyerItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
