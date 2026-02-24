import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { uploadPhoto } from "@/lib/storage";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  const created: { id: string; url: string }[] = [];

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadPhoto(buffer, file.name, projectId);
    const photo = await prisma.photo.create({
      data: { projectId, url },
    });
    created.push({ id: photo.id, url: photo.url });
  }

  return NextResponse.json({ created });
}
