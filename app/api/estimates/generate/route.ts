import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeEstimate } from "@/lib/pricing/canadaPricingEngine";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId ?? req.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const [project, userPricing] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      include: { scopes: { include: { items: true } } },
    }),
    prisma.userPricing.findMany({ where: { userId: session.user.id } }),
  ]);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const allScopeItems = project.scopes.flatMap((s) => s.items);
  if (allScopeItems.length === 0) {
    return NextResponse.json(
      { error: "Add scope items first" },
      { status: 400 }
    );
  }

  const pricingMap = Object.fromEntries(
    userPricing.map((p) => [p.key, { rate: p.rate, unit: p.unit }])
  );
  const result = computeEstimate(project.province, allScopeItems, pricingMap);

  // Create or replace draft estimate (never touch sealed)
  const existing = await prisma.estimate.findFirst({
    where: { projectId, status: "draft" },
    include: { lines: true },
  });

  if (existing) {
    await prisma.estimateLine.deleteMany({ where: { estimateId: existing.id } });
    await prisma.estimate.delete({ where: { id: existing.id } });
  }
  // If no existing draft, we create new. Sealed estimates are left intact.

  const estimate = await prisma.estimate.create({
    data: {
      projectId,
      status: "draft",
      totalLabor: result.totalLabor,
      totalMaterial: result.totalMaterial,
      totalMarkup: result.markup,
      totalTax: result.tax,
      grandTotal: result.grandTotal,
      assumptions: result.assumptions as object,
    },
  });

  for (const line of result.lines) {
    await prisma.estimateLine.create({
      data: {
        estimateId: estimate.id,
        scopeItemId: line.scopeItemId,
        laborCost: line.laborCost,
        materialCost: line.materialCost,
        markup: line.markup,
        tax: line.tax,
        laborHours: line.laborHours,
        laborRate: line.laborRate,
        materialUnitCost: line.materialUnitCost,
        quantity: line.quantity,
        unit: line.unit,
        materialName: line.materialName,
        pricingSource: line.pricingSource,
      },
    });
  }

  const full = await prisma.estimate.findUnique({
    where: { id: estimate.id },
    include: { lines: { include: { scopeItem: true } } },
  });

  return NextResponse.json({
    estimate: full,
    breakdown: result,
  });
}
