import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const properties = await prisma.userProperty.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(properties);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const property = await prisma.userProperty.create({
    data: {
      userId: session.user.id,
      description: body.description ?? "",
      purchasePrice: body.purchasePrice ?? 0,
      purchaseDate: body.purchaseDate ?? null,
      salePrice: body.salePrice ?? 0,
      saleDate: body.saleDate ?? null,
      sqft: body.sqft ?? 0,
      features: body.features ?? "",
      renoWork: body.renoWork ?? null,
      notes: body.notes ?? null,
    },
  });

  return NextResponse.json(property);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.userProperty.findFirst({
    where: { id: body.id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const property = await prisma.userProperty.update({
    where: { id: body.id },
    data: {
      description: body.description ?? existing.description,
      purchasePrice: body.purchasePrice ?? existing.purchasePrice,
      purchaseDate: body.purchaseDate !== undefined ? body.purchaseDate : existing.purchaseDate,
      salePrice: body.salePrice ?? existing.salePrice,
      saleDate: body.saleDate !== undefined ? body.saleDate : existing.saleDate,
      sqft: body.sqft ?? existing.sqft,
      features: body.features ?? existing.features,
      renoWork: body.renoWork !== undefined ? body.renoWork : existing.renoWork,
      notes: body.notes !== undefined ? body.notes : existing.notes,
    },
  });

  return NextResponse.json(property);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.userProperty.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.userProperty.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
