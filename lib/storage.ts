import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION ?? "auto";
const USE_LOCAL = !process.env.S3_BUCKET;

export async function uploadPhoto(
  buffer: Buffer,
  filename: string,
  projectId: string
): Promise<string> {
  if (USE_LOCAL) {
    const uploadDir = path.join(process.cwd(), "public", "uploads", projectId);
    await mkdir(uploadDir, { recursive: true });
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const filePath = path.join(uploadDir, safeName);
    await writeFile(filePath, buffer);
    return `/uploads/${projectId}/${safeName}`;
  }

  const client = new S3Client({
    region: REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_ACCESS_KEY_SECRET!,
        }
      : undefined,
  });

  const key = `photos/${projectId}/${Date.now()}-${filename}`;
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    })
  );

  return process.env.S3_PUBLIC_URL
    ? `${process.env.S3_PUBLIC_URL}/${key}`
    : `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}
