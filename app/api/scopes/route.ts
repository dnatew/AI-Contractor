import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const createSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
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

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, userId: session.user.id },
    include: { scopes: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const order = project.scopes.length;
  const scope = await prisma.scope.create({
    data: {
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description,
      order,
    },
  });

  return NextResponse.json(scope);
}
