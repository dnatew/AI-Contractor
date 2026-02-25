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

  const scopeItem = await prisma.scopeItem.findFirst({
    where: { id },
    include: { scope: { include: { project: true } } },
  });

  if (!scopeItem || scopeItem.scope.project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.scopeItem.update({
    where: { id },
    data: {
      ...(body.segment != null && { segment: String(body.segment) }),
      ...(body.task != null && { task: String(body.task) }),
      ...(body.material != null && { material: String(body.material) }),
      ...(body.quantity != null && { quantity: Number(body.quantity) }),
      ...(body.unit != null && { unit: String(body.unit) }),
      ...(body.laborHours != null && { laborHours: Number(body.laborHours) }),
      ...(body.source != null && { source: String(body.source) }),
      ...(body.progressPercent != null && { progressPercent: Number(body.progressPercent) }),
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

  const scopeItem = await prisma.scopeItem.findFirst({
    where: { id },
    include: { scope: { include: { project: true } } },
  });

  if (!scopeItem || scopeItem.scope.project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.scopeItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
