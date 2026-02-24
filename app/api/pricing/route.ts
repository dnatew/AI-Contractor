import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pricing = await prisma.userPricing.findMany({
    where: { userId: session.user.id },
    orderBy: { key: "asc" },
  });

  return NextResponse.json(pricing);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { key, rate, unit = "sqft" } = body;

  if (!key || typeof rate !== "number") {
    return NextResponse.json(
      { error: "key and rate (number) required" },
      { status: 400 }
    );
  }

  const pricing = await prisma.userPricing.upsert({
    where: {
      userId_key: { userId: session.user.id, key: String(key).trim() },
    },
    create: {
      userId: session.user.id,
      key: String(key).trim(),
      rate,
      unit: String(unit) || "sqft",
    },
    update: { rate, unit: String(unit) || "sqft" },
  });

  return NextResponse.json(pricing);
}
