import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const searches = await prisma.flipSearch.findMany({
    where: { userId: session.user.id, projectId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json(searches);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: body.projectId, userId: session.user.id },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const search = await prisma.flipSearch.create({
    data: {
      userId: session.user.id,
      projectId: body.projectId,
      title: body.title ?? null,
      purchasePrice: body.purchasePrice ?? 0,
      salePrice: body.salePrice ?? 0,
      renoCost: body.renoCost ?? 0,
      holdingMonths: body.holdingMonths ?? 0,
      monthlyMortgage: body.monthlyMortgage ?? 0,
      monthlyTaxes: body.monthlyTaxes ?? 0,
      monthlyInsurance: body.monthlyInsurance ?? 0,
      monthlyUtilities: body.monthlyUtilities ?? 0,
      realtorPct: body.realtorPct ?? 0,
      legalFees: body.legalFees ?? 0,
      staging: body.staging ?? 0,
      userNotes: body.userNotes ?? null,
      aiReasoning: body.aiReasoning ?? null,
      comparablesFound: body.comparablesFound ?? null,
      marketType: body.marketType ?? null,
      roiPatternJson: body.roiPatternJson ?? null,
    },
  });

  return NextResponse.json(search);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const projectId = searchParams.get("projectId");
  const clearAll = searchParams.get("all") === "1";

  if (id) {
    const existing = await prisma.flipSearch.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.flipSearch.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  if (clearAll && projectId) {
    await prisma.flipSearch.deleteMany({
      where: { userId: session.user.id, projectId },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "id or projectId+all=1 required" }, { status: 400 });
}
