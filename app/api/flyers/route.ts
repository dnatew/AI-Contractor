import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const flyers = await prisma.flyer.findMany({
      where: { userId },
      orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
      include: {
        items: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json({ flyers });
  } catch (err) {
    // Fail-soft if flyer tables are missing in an environment.
    const msg = err instanceof Error ? err.message : String(err);
    const tableMissing =
      msg.includes("P2021") ||
      msg.toLowerCase().includes("does not exist") ||
      msg.toLowerCase().includes("relation");
    if (tableMissing) {
      return NextResponse.json({ flyers: [], warning: "Flyer tables not available in this environment yet." });
    }
    return NextResponse.json(
      { error: "Failed to load flyers." },
      { status: 500 }
    );
  }
}
