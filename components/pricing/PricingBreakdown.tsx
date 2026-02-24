"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  Clock,
  Package,
  Sparkles,
  Pen,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { Estimate, EstimateLine, ScopeItem } from "@prisma/client";

type FullLine = EstimateLine & { scopeItem: ScopeItem };
type EstimateWithLines = Estimate & { lines: FullLine[] };

type PricingBreakdownProps = {
  projectId: string;
  province: string;
  estimate: EstimateWithLines | null;
  showValueTracking?: boolean;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
}

function fmtShort(n: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

function GroupedEstimateTable({ lines }: { lines: FullLine[] }) {
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(new Set());

  const grouped = new Map<string, FullLine[]>();
  for (const line of lines) {
    const seg = line.scopeItem.segment;
    if (!grouped.has(seg)) grouped.set(seg, []);
    grouped.get(seg)!.push(line);
  }

  function toggleSegment(seg: string) {
    setExpandedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(seg)) next.delete(seg); else next.add(seg);
      return next;
    });
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-slate-200">
        <div className="col-span-4">Item</div>
        <div className="col-span-3 text-right">Labor</div>
        <div className="col-span-3 text-right">Material</div>
        <div className="col-span-2 text-right">Line total</div>
      </div>

      {Array.from(grouped.entries()).map(([segment, segLines]) => {
        const segLabor = segLines.reduce((s, l) => s + l.laborCost, 0);
        const segMaterial = segLines.reduce((s, l) => s + l.materialCost, 0);
        const segTotal = segLines.reduce((s, l) => s + l.laborCost + l.materialCost + l.markup + l.tax, 0);
        const expanded = expandedSegments.has(segment);

        return (
          <div key={segment}>
            {/* Segment header row */}
            <button
              onClick={() => toggleSegment(segment)}
              className="w-full grid grid-cols-12 gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors rounded-lg items-center text-left"
            >
              <div className="col-span-4 flex items-center gap-2">
                {expanded ? <ChevronUp className="size-3.5 text-slate-400" /> : <ChevronDown className="size-3.5 text-slate-400" />}
                <span className="text-sm font-semibold text-slate-800">{segment}</span>
                <span className="text-xs text-slate-400">{segLines.length}</span>
              </div>
              <div className="col-span-3 text-right text-sm text-slate-600">{fmtShort(segLabor)}</div>
              <div className="col-span-3 text-right text-sm text-slate-600">{fmtShort(segMaterial)}</div>
              <div className="col-span-2 text-right text-sm font-semibold text-slate-800">{fmtShort(segTotal)}</div>
            </button>

            {/* Expanded lines */}
            {expanded && (
              <div className="ml-6 border-l-2 border-slate-100 space-y-px">
                {segLines.map((line) => {
                  const lineTotal = line.laborCost + line.materialCost + line.markup + line.tax;
                  const hasDetail = line.laborHours != null;

                  return (
                    <div
                      key={line.id}
                      className="grid grid-cols-12 gap-2 px-3 py-2 hover:bg-slate-50/50 transition-colors items-start"
                    >
                      {/* Task + source */}
                      <div className="col-span-4">
                        <p className="text-sm text-slate-800">{line.scopeItem.task}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {line.pricingSource === "user" ? (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-blue-200 text-blue-600 bg-blue-50">
                              <Pen className="size-2 mr-0.5" />Your rate
                            </Badge>
                          ) : line.pricingSource === "default" ? (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-slate-200 text-slate-500">
                              <Sparkles className="size-2 mr-0.5" />Default
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      {/* Labor detail */}
                      <div className="col-span-3 text-right">
                        <p className="text-sm text-slate-700 tabular-nums">{fmt(line.laborCost)}</p>
                        {hasDetail && (
                          <p className="text-[11px] text-slate-400 tabular-nums flex items-center justify-end gap-1 mt-0.5">
                            <Clock className="size-2.5" />
                            {line.laborHours!.toFixed(1)}h × ${line.laborRate!.toFixed(0)}/hr
                          </p>
                        )}
                      </div>

                      {/* Material detail */}
                      <div className="col-span-3 text-right">
                        <p className="text-sm text-slate-700 tabular-nums">{fmt(line.materialCost)}</p>
                        {hasDetail && (
                          <div className="mt-0.5">
                            <p className="text-[11px] text-slate-400 tabular-nums flex items-center justify-end gap-1">
                              <Package className="size-2.5" />
                              {line.quantity?.toFixed(0)} {line.unit} × ${line.materialUnitCost?.toFixed(2)}
                            </p>
                            {line.materialName && line.materialName !== "general" && line.materialName !== "included in rate" && (
                              <p className="text-[10px] text-slate-400 capitalize">{line.materialName}</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Line total */}
                      <div className="col-span-2 text-right">
                        <p className="text-sm font-medium text-slate-800 tabular-nums">{fmt(lineTotal)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PricingBreakdown({ projectId, province, estimate, showValueTracking = true }: PricingBreakdownProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  async function generateEstimate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  if (!estimate) {
    return (
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <DollarSign className="size-5 text-slate-400" />
            <div>
              <CardTitle className="text-slate-900">Estimate</CardTitle>
              <CardDescription className="text-slate-600">Province-aware pricing for {province}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button onClick={generateEstimate} disabled={generating} className="gap-2">
            <Sparkles className="size-4" />
            {generating ? "Generating..." : "Generate Estimate"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const assumptions = estimate.assumptions as {
    laborRate?: number;
    taxName?: string;
    markupPercent?: number;
  } | null;

  const userLines = estimate.lines.filter((l) => l.pricingSource === "user").length;
  const totalLines = estimate.lines.length;

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="size-5 text-slate-400" />
            <div>
              <CardTitle className="text-slate-900">Estimate</CardTitle>
              <CardDescription className="text-slate-600">
                {province} · {assumptions?.taxName}
                {userLines > 0 && (
                  <> · <span className="text-blue-600">{userLines}/{totalLines} items using your rates</span></>
                )}
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Button size="sm" variant="outline" onClick={generateEstimate} disabled={generating} className="gap-1.5">
              <RefreshCw className={`size-3.5 ${generating ? "animate-spin" : ""}`} />
              {generating ? "Updating..." : "Regenerate"}
            </Button>
            <Badge variant="secondary" className="capitalize">{estimate.status}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Assumptions bar */}
        {assumptions && (
          <div className="flex flex-wrap gap-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            <span className="flex items-center gap-1"><Clock className="size-3" /> ${assumptions.laborRate}/hr</span>
            <span className="text-slate-300">·</span>
            <span>{assumptions.markupPercent}% markup</span>
            <span className="text-slate-300">·</span>
            <span>{assumptions.taxName}</span>
          </div>
        )}

        {/* Grouped table */}
        <GroupedEstimateTable lines={estimate.lines} />

        {/* Totals */}
        <div className="border-t border-slate-200 pt-4 space-y-1.5">
          <div className="flex justify-between text-sm text-slate-600">
            <span className="flex items-center gap-1.5"><Clock className="size-3.5" /> Labor</span>
            <span className="tabular-nums">{fmt(estimate.totalLabor)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span className="flex items-center gap-1.5"><Package className="size-3.5" /> Materials</span>
            <span className="tabular-nums">{fmt(estimate.totalMaterial)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>Markup ({assumptions?.markupPercent ?? 15}%)</span>
            <span className="tabular-nums">{fmt(estimate.totalMarkup)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>Tax ({assumptions?.taxName})</span>
            <span className="tabular-nums">{fmt(estimate.totalTax)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-slate-900 pt-2 border-t border-slate-200">
            <span>Total</span>
            <span className="tabular-nums">{fmt(estimate.grandTotal)}</span>
          </div>

          {/* Value tracking */}
          {showValueTracking && estimate.lines.length > 0 && (() => {
            const quoteAmount = estimate.confirmedAmount ?? estimate.grandTotal;
            let valueCompleted = 0;
            for (const line of estimate.lines) {
              const lineTotal = line.laborCost + line.materialCost + line.markup + line.tax;
              const pct = (line.scopeItem.progressPercent ?? 0) / 100;
              valueCompleted += lineTotal * pct;
            }
            const valueOutstanding = Math.max(0, quoteAmount - valueCompleted);
            const hasProgress = estimate.lines.some((l) => (l.scopeItem.progressPercent ?? 0) > 0);
            if (!hasProgress && !estimate.confirmedAmount) return null;
            const pctDone = quoteAmount > 0 ? (valueCompleted / quoteAmount) * 100 : 0;
            return (
              <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Value tracking</p>
                {hasProgress && (
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, pctDone)}%` }} />
                  </div>
                )}
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Quote amount</span>
                  <span className="tabular-nums">{fmt(quoteAmount)}</span>
                </div>
                {hasProgress && (
                  <>
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>Completed ({pctDone.toFixed(0)}%)</span>
                      <span className="tabular-nums">{fmt(valueCompleted)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-amber-600">
                      <span>Outstanding</span>
                      <span className="tabular-nums">{fmt(valueOutstanding)}</span>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
}
