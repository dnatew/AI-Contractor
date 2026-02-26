import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { uploadPhoto } from "@/lib/storage";
import { normalizeTokens } from "@/lib/flyers";

const MAX_FLYER_FILE_BYTES = 4 * 1024 * 1024; // keep under common serverless payload limits
const MAX_FLYER_FILES_PER_REQUEST = 6;

type OcrFlyerItem = {
  name: string;
  unitLabel?: string;
  price: number;
  promoNotes?: string;
  estimateUseCases?: string[];
  rawText?: string;
};

type OcrFlyerPayload = {
  storeName?: string;
  releaseDate?: string;
  parsedSummary?: string;
  items: OcrFlyerItem[];
};

async function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: key });
}

function cleanJson(text: string): string {
  return text.replace(/```json\n?|\n?```/g, "").trim();
}

function parseDateInput(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function extractFlyerData(buffer: Buffer, filename: string): Promise<OcrFlyerPayload> {
  const openai = await getOpenAI();
  const extractionPrompt =
    "Extract hardware store flyer products into JSON. Return ONLY valid JSON: {storeName?:string,releaseDate?:string,parsedSummary?:string,items:[{name:string,unitLabel?:string,price:number,promoNotes?:string,estimateUseCases?:string[],rawText?:string}]}. Include 3-60 items. Use CAD prices only. estimateUseCases should describe renovation estimate tasks this item can support (e.g., tile install, backsplash, trim, flooring, paint prep).";
  const lower = filename.toLowerCase();
  const isPdf = lower.endsWith(".pdf");

  if (isPdf) {
    const pdfBytes = Uint8Array.from(buffer);
    const uploaded = await openai.files.create({
      file: new File([pdfBytes], filename, { type: "application/pdf" }),
      purpose: "user_data",
    });
    try {
      const pdfRes = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `${extractionPrompt}\nRead this flyer PDF and extract products/prices/use-cases.`,
              },
              { type: "input_file", file_id: uploaded.id },
            ],
          },
        ],
        max_output_tokens: 1800,
      });
      const rawText =
        (typeof (pdfRes as { output_text?: unknown }).output_text === "string"
          ? String((pdfRes as { output_text?: unknown }).output_text)
          : "") || "{\"items\":[]}";
      const parsed = JSON.parse(cleanJson(rawText)) as Partial<OcrFlyerPayload>;
      const items = Array.isArray(parsed.items)
        ? parsed.items
            .map((it) => {
              const obj = it as Record<string, unknown>;
              const price = Number(obj.price);
              const estimateUseCases = Array.isArray(obj.estimateUseCases)
                ? (obj.estimateUseCases as unknown[])
                    .map((x) => String(x ?? "").trim())
                    .filter(Boolean)
                    .slice(0, 8)
                : [];
              return {
                name: String(obj.name ?? "").trim(),
                unitLabel: String(obj.unitLabel ?? "").trim() || undefined,
                price: Number.isFinite(price) ? price : NaN,
                promoNotes: String(obj.promoNotes ?? "").trim() || undefined,
                estimateUseCases,
                rawText: String(obj.rawText ?? "").trim() || undefined,
              };
            })
            .filter((it) => it.name && Number.isFinite(it.price) && it.price > 0)
            .slice(0, 120)
        : [];
      return {
        storeName: parsed.storeName?.trim(),
        releaseDate: parsed.releaseDate?.trim(),
        parsedSummary: parsed.parsedSummary?.trim(),
        items,
      };
    } finally {
      try {
        await openai.files.delete(uploaded.id);
      } catch {
        // no-op
      }
    }
  }

  const mime = filename.toLowerCase().endsWith(".png")
    ? "image/png"
    : filename.toLowerCase().endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: extractionPrompt,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this flyer image and extract products and prices." },
          { type: "image_url", image_url: { url: dataUrl } },
        ] as unknown as string,
      },
    ],
    max_tokens: 1800,
  });

  const raw = res.choices[0]?.message?.content ?? "{\"items\":[]}";
  const parsed = JSON.parse(cleanJson(raw)) as Partial<OcrFlyerPayload>;
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map((it) => {
          const obj = it as Record<string, unknown>;
          const price = Number(obj.price);
          const estimateUseCases = Array.isArray(obj.estimateUseCases)
            ? (obj.estimateUseCases as unknown[])
                .map((x) => String(x ?? "").trim())
                .filter(Boolean)
                .slice(0, 8)
            : [];
          return {
            name: String(obj.name ?? "").trim(),
            unitLabel: String(obj.unitLabel ?? "").trim() || undefined,
            price: Number.isFinite(price) ? price : NaN,
            promoNotes: String(obj.promoNotes ?? "").trim() || undefined,
            estimateUseCases,
            rawText: String(obj.rawText ?? "").trim() || undefined,
          };
        })
        .filter((it) => it.name && Number.isFinite(it.price) && it.price > 0)
        .slice(0, 80)
    : [];

  return {
    storeName: parsed.storeName?.trim(),
    releaseDate: parsed.releaseDate?.trim(),
    parsedSummary: parsed.parsedSummary?.trim(),
    items,
  };
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }
  if (files.length > MAX_FLYER_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many files. Upload up to ${MAX_FLYER_FILES_PER_REQUEST} files at a time.` },
      { status: 400 }
    );
  }
  const oversize = files.filter((f) => f.size > MAX_FLYER_FILE_BYTES);
  if (oversize.length > 0) {
    return NextResponse.json(
      {
        error: `One or more files are too large. Keep each file under ${Math.floor(MAX_FLYER_FILE_BYTES / (1024 * 1024))}MB.`,
        files: oversize.map((f) => f.name),
      },
      { status: 413 }
    );
  }

  const createdFlyers: Array<{
    id: string;
    imageUrl: string;
    storeName: string | null;
    releaseDate: Date | null;
    parsedSummary: string | null;
    items: Array<{
      id: string;
      name: string;
      unitLabel: string | null;
      price: number;
      promoNotes: string | null;
      rawText: string | null;
      normalizedTokens: unknown;
    }>;
  }> = [];

  for (const file of files) {
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!file.type.startsWith("image/") && !isPdf) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    let imageUrl = isPdf
      ? `flyer://${safeName}`
      : "/uploads/typing-cat-typing.gif";
    try {
      imageUrl = await uploadPhoto(
        buffer,
        file.name,
        `flyers-${userId}`,
        isPdf ? "application/pdf" : file.type || "image/jpeg"
      );
    } catch {
      // Keep processing even when object/file storage is unavailable in the runtime.
      // Flyer rows still provide pricing context for estimates/deep dives.
    }

    let extracted: OcrFlyerPayload = { items: [] };
    try {
      extracted = await extractFlyerData(buffer, file.name);
    } catch {
      extracted = { items: [] };
    }

    const releaseDateFromForm = parseDateInput(String(formData.get("releaseDate") ?? ""));
    const releaseDateFromOcr = parseDateInput(extracted.releaseDate);
    const storeNameFromForm = String(formData.get("storeName") ?? "").trim();
    const parsedSummaryFromForm = String(formData.get("parsedSummary") ?? "").trim();

    const flyer = await prisma.flyer.create({
      data: {
        userId,
        imageUrl,
        storeName: storeNameFromForm || extracted.storeName || null,
        releaseDate: releaseDateFromForm ?? releaseDateFromOcr,
        parsedSummary: parsedSummaryFromForm || extracted.parsedSummary || null,
        items: {
          create: extracted.items.map((item) => ({
            promoNotes:
              [item.promoNotes, item.estimateUseCases?.length ? `Use cases: ${item.estimateUseCases.join(", ")}` : ""]
                .filter(Boolean)
                .join(" · ") || null,
            name: item.name,
            unitLabel: item.unitLabel ?? null,
            price: Number(item.price.toFixed(2)),
            rawText: item.rawText ?? null,
            normalizedTokens: normalizeTokens(
              item.name,
              item.unitLabel,
              item.promoNotes,
              item.rawText,
              ...(item.estimateUseCases ?? [])
            ),
          })),
        },
      },
      include: { items: true },
    });

    createdFlyers.push(flyer);
  }

  if (createdFlyers.length === 0) {
    return NextResponse.json(
      { error: "No supported files detected. Upload images or PDF flyers." },
      { status: 400 }
    );
  }

  return NextResponse.json({ flyers: createdFlyers });
}
