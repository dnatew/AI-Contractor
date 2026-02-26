import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
};

type TrackAiUsageInput = {
  userId: string;
  projectId?: string | null;
  route: string;
  operation: string;
  model: string;
  usage?: UsageLike | null;
  metadata?: Record<string, unknown>;
};

type ModelRate = {
  inputPer1M: number;
  outputPer1M: number;
};

const DEFAULT_MODEL_RATE: ModelRate = {
  inputPer1M: 0.15,
  outputPer1M: 0.6,
};

const MODEL_RATES: Record<string, ModelRate> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o-mini-search-preview": { inputPer1M: 0.15, outputPer1M: 0.6 },
};

function toTokenNumbers(usage?: UsageLike | null) {
  const inputTokens = Math.max(
    0,
    Math.floor(usage?.prompt_tokens ?? usage?.input_tokens ?? 0)
  );
  const outputTokens = Math.max(
    0,
    Math.floor(usage?.completion_tokens ?? usage?.output_tokens ?? 0)
  );
  const totalTokens = Math.max(
    0,
    Math.floor(usage?.total_tokens ?? inputTokens + outputTokens)
  );
  return { inputTokens, outputTokens, totalTokens };
}

function estimateRawCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const rates = MODEL_RATES[model] ?? DEFAULT_MODEL_RATE;
  const inputCost = (inputTokens / 1_000_000) * rates.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPer1M;
  return inputCost + outputCost;
}

function resolveMarkupMultiplier() {
  const parsed = Number.parseFloat(process.env.AI_TOKEN_MARKUP_MULTIPLIER ?? "1");
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

export async function trackAiUsage(input: TrackAiUsageInput) {
  const { inputTokens, outputTokens, totalTokens } = toTokenNumbers(input.usage);
  if (totalTokens <= 0) return;

  const rawCostUsd = estimateRawCostUsd(input.model, inputTokens, outputTokens);
  const billedCostUsd = rawCostUsd * resolveMarkupMultiplier();

  const metadataJson = input.metadata
    ? (JSON.parse(JSON.stringify(input.metadata)) as Prisma.InputJsonValue)
    : undefined;

  try {
    await prisma.aiUsageEvent.create({
      data: {
        userId: input.userId,
        projectId: input.projectId ?? null,
        route: input.route,
        operation: input.operation,
        model: input.model,
        inputTokens,
        outputTokens,
        totalTokens,
        rawCostUsd,
        billedCostUsd,
        metadata: metadataJson,
      },
    });
  } catch (err) {
    // Non-blocking: AI route should not fail if tracking write fails.
    console.warn("ai usage tracking failed", err);
  }
}
