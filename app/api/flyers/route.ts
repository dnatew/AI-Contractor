import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { access, readdir } from "fs/promises";
import path from "path";

function isFlyerSchemeUrl(url: string): boolean {
  return /^flyer:\/\//i.test(url);
}

async function resolveLegacyFlyerUrl(url: string, userId: string): Promise<string> {
  if (!isFlyerSchemeUrl(url)) return url;
  const fileName = url.replace(/^flyer:\/\//i, "").trim();
  if (!fileName) return url;
  const localUrl = `/uploads/flyers-${userId}/${fileName}`;
  const localPath = path.join(process.cwd(), "public", localUrl.replace(/^\//, ""));
  try {
    await access(localPath);
    return localUrl;
  } catch {
    const folderPath = path.join(process.cwd(), "public", "uploads", `flyers-${userId}`);
    try {
      const entries = await readdir(folderPath);
      const matched = entries.find((name) => name === fileName || name.endsWith(`-${fileName}`));
      if (matched) {
        return `/uploads/flyers-${userId}/${matched}`;
      }
      return url;
    } catch {
      return url;
    }
  }
}

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

    const hydratedFlyers = await Promise.all(
      flyers.map(async (flyer) => ({
        ...flyer,
        imageUrl: await resolveLegacyFlyerUrl(flyer.imageUrl, userId),
      }))
    );

    return NextResponse.json({ flyers: hydratedFlyers });
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
