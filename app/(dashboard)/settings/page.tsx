import { getServerSession } from "next-auth";
import { authOptions, getOrCreateUserId } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PricingSettings } from "@/components/settings/PricingSettings";
import { AiUsageSettings } from "@/components/settings/AiUsageSettings";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = await getOrCreateUserId(session);
  if (!userId) redirect("/login");

  const pricing = await prisma.userPricing.findMany({
    where: { userId },
    orderBy: { key: "asc" },
  });
  const aiUsage = await prisma.aiUsageEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const totals = aiUsage.reduce(
    (acc, row) => {
      acc.totalCalls += 1;
      acc.inputTokens += row.inputTokens;
      acc.outputTokens += row.outputTokens;
      acc.totalTokens += row.totalTokens;
      acc.rawCostUsd += row.rawCostUsd;
      acc.billedCostUsd += row.billedCostUsd;
      return acc;
    },
    {
      totalCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      rawCostUsd: 0,
      billedCostUsd: 0,
    }
  );

  const byRouteMap = new Map<string, { calls: number; tokens: number; billedCostUsd: number }>();
  const byOperationMap = new Map<string, { calls: number; tokens: number; billedCostUsd: number }>();
  for (const row of aiUsage) {
    const route = byRouteMap.get(row.route) ?? { calls: 0, tokens: 0, billedCostUsd: 0 };
    route.calls += 1;
    route.tokens += row.totalTokens;
    route.billedCostUsd += row.billedCostUsd;
    byRouteMap.set(row.route, route);

    const op = byOperationMap.get(row.operation) ?? { calls: 0, tokens: 0, billedCostUsd: 0 };
    op.calls += 1;
    op.tokens += row.totalTokens;
    op.billedCostUsd += row.billedCostUsd;
    byOperationMap.set(row.operation, op);
  }
  const byRoute = Array.from(byRouteMap.entries())
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.tokens - a.tokens);
  const byOperation = Array.from(byOperationMap.entries())
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.tokens - a.tokens);
  const recent = aiUsage.slice(0, 15).map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    route: row.route,
    operation: row.operation,
    model: row.model,
    totalTokens: row.totalTokens,
    billedCostUsd: row.billedCostUsd,
  }));
  const markupMultiplier = Number.parseFloat(process.env.AI_TOKEN_MARKUP_MULTIPLIER ?? "1") || 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-600">Your pricing rates and preferences</p>
      </div>
      <AiUsageSettings
        totals={totals}
        byRoute={byRoute}
        byOperation={byOperation}
        recent={recent}
        markupMultiplier={markupMultiplier}
      />
      <PricingSettings initialPricing={pricing} />
    </div>
  );
}
