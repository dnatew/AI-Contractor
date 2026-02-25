import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pricing = await prisma.userPricing.findMany({
    where: { userId },
    orderBy: { key: "asc" },
  });

  return NextResponse.json(pricing);
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
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
      userId_key: { userId, key: String(key).trim() },
    },
    create: {
      userId,
      key: String(key).trim(),
      rate,
      unit: String(unit) || "sqft",
    },
    update: { rate, unit: String(unit) || "sqft" },
  });

  return NextResponse.json(pricing);
}
