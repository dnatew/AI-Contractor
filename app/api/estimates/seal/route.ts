import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const estimateId = body.estimateId ?? req.nextUrl.searchParams.get("estimateId");

  if (!estimateId) {
    return NextResponse.json({ error: "estimateId required" }, { status: 400 });
  }

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId },
    include: { project: true },
  });

  if (!estimate || estimate.project.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (estimate.status === "sealed") {
    return NextResponse.json({ error: "Already sealed" }, { status: 400 });
  }

  const confirmedAmount = typeof body.confirmedAmount === "number" ? body.confirmedAmount : null;

  const sealed = await prisma.estimate.update({
    where: { id: estimateId },
    data: {
      status: "sealed",
      sealedAt: new Date(),
      ...(confirmedAmount != null && { confirmedAmount }),
    },
  });

  return NextResponse.json(sealed);
}
