import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type UsageTotals = {
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  rawCostUsd: number;
  billedCostUsd: number;
};

type UsageGroup = {
  name: string;
  calls: number;
  tokens: number;
  billedCostUsd: number;
};

type UsageRecent = {
  id: string;
  createdAt: Date;
  route: string;
  operation: string;
  model: string;
  totalTokens: number;
  billedCostUsd: number;
};

type AiUsageSettingsProps = {
  totals: UsageTotals;
  byRoute: UsageGroup[];
  byOperation: UsageGroup[];
  recent: UsageRecent[];
  markupMultiplier: number;
};

function usd(v: number) {
  return `$${v.toFixed(4)}`;
}

export function AiUsageSettings({
  totals,
  byRoute,
  byOperation,
  recent,
  markupMultiplier,
}: AiUsageSettingsProps) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="text-slate-900">AI Token Usage</CardTitle>
        <CardDescription className="text-slate-600">
          Tracks real OpenAI token usage per user and estimates billable cost with your markup multiplier ({markupMultiplier.toFixed(2)}x).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <div className="rounded-md border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Calls</p>
            <p className="text-sm font-semibold text-slate-900">{totals.totalCalls}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Input tokens</p>
            <p className="text-sm font-semibold text-slate-900">{totals.inputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Output tokens</p>
            <p className="text-sm font-semibold text-slate-900">{totals.outputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Total tokens</p>
            <p className="text-sm font-semibold text-slate-900">{totals.totalTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Raw cost (est.)</p>
            <p className="text-sm font-semibold text-slate-900">{usd(totals.rawCostUsd)}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Billable cost</p>
            <p className="text-sm font-semibold text-slate-900">{usd(totals.billedCostUsd)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-800">By route</p>
            <div className="space-y-2">
              {byRoute.length === 0 && <p className="text-xs text-slate-500">No tracked usage yet.</p>}
              {byRoute.slice(0, 8).map((row) => (
                <div key={row.name} className="flex items-center justify-between text-xs">
                  <span className="truncate text-slate-700">{row.name}</span>
                  <Badge variant="outline">{row.tokens.toLocaleString()} tok · {usd(row.billedCostUsd)}</Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-800">By operation</p>
            <div className="space-y-2">
              {byOperation.length === 0 && <p className="text-xs text-slate-500">No tracked usage yet.</p>}
              {byOperation.slice(0, 8).map((row) => (
                <div key={row.name} className="flex items-center justify-between text-xs">
                  <span className="truncate text-slate-700">{row.name}</span>
                  <Badge variant="outline">{row.tokens.toLocaleString()} tok · {usd(row.billedCostUsd)}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 p-3">
          <p className="mb-2 text-sm font-medium text-slate-800">Recent AI calls</p>
          <div className="space-y-2">
            {recent.length === 0 && <p className="text-xs text-slate-500">No tracked usage yet.</p>}
            {recent.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                <span>{row.createdAt.toLocaleString()}</span>
                <span className="font-medium">{row.operation}</span>
                <span>{row.model}</span>
                <span>{row.totalTokens.toLocaleString()} tok</span>
                <span>{usd(row.billedCostUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
