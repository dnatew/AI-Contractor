import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const createSchema = z.object({
  scopeId: z.string(),
  segment: z.string().default("General"),
  task: z.string(),
  material: z.string(),
  quantity: z.number().default(0),
  unit: z.string().default("sqft"),
  laborHours: z.number().default(0),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const scope = await prisma.scope.findFirst({
    where: { id: parsed.data.scopeId },
    include: { project: true },
  });
  if (!scope || scope.project.userId !== session.user.id) {
    return NextResponse.json({ error: "Scope not found" }, { status: 404 });
  }

  const item = await prisma.scopeItem.create({
    data: {
      scopeId: parsed.data.scopeId,
      segment: parsed.data.segment,
      task: parsed.data.task,
      material: parsed.data.material,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      laborHours: parsed.data.laborHours,
      source: "user",
    },
  });

  return NextResponse.json(item);
}
