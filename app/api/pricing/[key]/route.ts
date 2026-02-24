import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;
  const decoded = decodeURIComponent(key);

  await prisma.userPricing.deleteMany({
    where: { userId: session.user.id, key: decoded },
  });

  return NextResponse.json({ ok: true });
}
