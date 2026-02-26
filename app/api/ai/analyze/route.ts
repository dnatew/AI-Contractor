import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  PHOTO_TAG_PROMPT,
  SCOPE_SYNTHESIS_PROMPT,
  buildPhotoTagContext,
  buildScopeContext,
} from "@/lib/ai/prompts/scopePrompt";
import { trackAiUsage } from "@/lib/aiUsage";
import path from "path";
import { readFile } from "fs/promises";

async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: key });
}

function getImagePath(url: string): string | null {
  if (url.startsWith("/uploads/")) {
    return path.join(process.cwd(), "public", url);
  }
  return null;
}

async function tagPhoto(
  imagePath: string,
  context: string,
  userId: string,
  projectId: string
): Promise<{
  room: string;
  surfaceType: string;
  condition: string;
  tasks: string[];
  materials: string[];
  confidence: number;
}> {
  const buffer = await readFile(imagePath);
  const base64 = buffer.toString("base64");
  const ext = path.extname(imagePath).slice(1) || "jpeg";
  const mime = ext === "png" ? "image/png" : "image/jpeg";

  const openai = await getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: PHOTO_TAG_PROMPT,
      },
      {
        role: "user",
        content: [
          { type: "text", text: context || "No additional context." },
          {
            type: "image_url",
            image_url: {
              url: `data:${mime};base64,${base64}`,
            },
          },
        ],
      },
    ],
    max_tokens: 500,
  });
  await trackAiUsage({
    userId,
    projectId,
    route: "/api/ai/analyze",
    operation: "tag_photo",
    model: "gpt-4o-mini",
    usage: res.usage,
  });

  const text = res.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
  return {
    room: parsed.room ?? "Unknown",
    surfaceType: parsed.surfaceType ?? "unknown",
    condition: parsed.condition ?? "unknown",
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    materials: Array.isArray(parsed.materials) ? parsed.materials : [],
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId ?? req.nextUrl.searchParams.get("projectId");
  const refinePrompt = body.refinePrompt as string | undefined;
  const photoIds = body.photoIds as string[] | undefined;

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: { photos: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const photosToProcess = photoIds?.length
    ? project.photos.filter((p) => photoIds.includes(p.id))
    : project.photos;

  if (photosToProcess.length === 0) {
    return NextResponse.json({ error: "No photos to analyze" }, { status: 400 });
  }

  const context = buildPhotoTagContext(project.jobPrompt, project.sqft);

  // Process photos in parallel (max 3 concurrent to avoid rate limits)
  const concurrency = 3;
  for (let i = 0; i < photosToProcess.length; i += concurrency) {
    const batch = photosToProcess.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (photo) => {
        const imagePath = getImagePath(photo.url);
        if (!imagePath) return;
        try {
          const tags = await tagPhoto(imagePath, context, userId, projectId);
          await prisma.photo.update({
            where: { id: photo.id },
            data: {
              aiTags: tags,
              aiConfidence: tags.confidence,
              roomLabel: tags.room,
            },
          });
        } catch (err) {
          console.error("Photo tag error:", photo.id, err);
        }
      })
    );
  }

  const scopeContext = buildScopeContext(
    project.jobPrompt,
    project.address,
    project.province,
    project.sqft
  );

  const allPhotos = await prisma.photo.findMany({
    where: { projectId },
  });
  const tagsSummary = allPhotos
    .filter((p) => p.aiTags)
    .map((p) => ({
      room: (p.aiTags as { room?: string })?.room ?? p.roomLabel,
      ...(p.aiTags as object),
    }));

  const synthesisPrompt = `${SCOPE_SYNTHESIS_PROMPT}

${scopeContext}

Photo tags:
${JSON.stringify(tagsSummary, null, 2)}

${refinePrompt ? `Additional instructions: ${refinePrompt}` : ""}

Return only valid JSON array.`;

  const openai2 = await getOpenAI();
  const res = await openai2.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a construction scope estimator. Output only valid JSON." },
      { role: "user", content: synthesisPrompt },
    ],
    max_tokens: 1500,
  });
  await trackAiUsage({
    userId,
    projectId,
    route: "/api/ai/analyze",
    operation: "synthesize_scope",
    model: "gpt-4o-mini",
    usage: res.usage,
  });

  const text = res.choices[0]?.message?.content ?? "[]";
  const scopeItems = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
  if (!Array.isArray(scopeItems)) {
    return NextResponse.json({ error: "Invalid scope response" }, { status: 500 });
  }

  // Get or create Main scope
  let mainScope = await prisma.scope.findFirst({
    where: { projectId, name: "Main" },
  });
  if (!mainScope) {
    mainScope = await prisma.scope.create({
      data: { projectId, name: "Main", description: "AI-generated scope", order: 0 },
    });
  }

  await prisma.scopeItem.deleteMany({ where: { scopeId: mainScope.id } });
  for (const item of scopeItems) {
    await prisma.scopeItem.create({
      data: {
        scopeId: mainScope.id,
        segment: item.segment ?? "General",
        task: item.task ?? "",
        material: item.material ?? "",
        quantity: item.quantity ?? 0,
        unit: item.unit ?? "sqft",
        laborHours: item.laborHours ?? 0,
        source: "AI",
      },
    });
  }

  const scope = await prisma.scope.findUnique({
    where: { id: mainScope.id },
    include: { items: true },
  });
  return NextResponse.json({ scope, photosUpdated: photosToProcess.length });
}
