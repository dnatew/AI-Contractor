"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
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

type WizardQuestion = {
  id: string;
  question: string;
  emoji?: string;
  type?: "multiple_choice" | "text";
  options?: Array<{ id: string; label: string; emoji?: string }>;
  placeholder?: string;
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
  const [loadingWizard, setLoadingWizard] = useState(false);
  const [estimatePrompt, setEstimatePrompt] = useState("");
  const [wizardQuestions, setWizardQuestions] = useState<WizardQuestion[]>([]);
  const [wizardIndex, setWizardIndex] = useState(0);
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, { quantity?: number; materialUnitCost?: number; laborHours?: number; materialName?: string }>>({});

  const lineWarnings = useMemo(() => {
    const a = estimate?.assumptions as { lineWarnings?: string[] } | null;
    return Array.isArray(a?.lineWarnings) ? a.lineWarnings : [];
  }, [estimate]);

  const priorRefinementAnswers = useMemo(() => {
    const a = estimate?.assumptions as { refinementAnswers?: Record<string, string> } | null;
    return (a?.refinementAnswers ?? {}) as Record<string, string>;
  }, [estimate]);

  async function fetchEstimateWizard(options?: { autoGenerateIfEmpty?: boolean }) {
    setLoadingWizard(true);
    try {
      const mergedAnswers = { ...priorRefinementAnswers, ...wizardAnswers };
      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode: "questions",
          estimatePrompt: estimatePrompt.trim() || undefined,
          refinementAnswers: mergedAnswers,
        }),
      });
      if (!res.ok) {
        if (options?.autoGenerateIfEmpty) {
          await runEstimateGeneration();
        }
        return false;
      }
      const data = await res.json();
      if (Array.isArray(data.questions) && data.questions.length > 0) {
        setWizardQuestions(
          (data.questions as Array<Record<string, unknown>>).map((q) => ({
            id: String(q.id ?? ""),
            question: String(q.question ?? ""),
            emoji: typeof q.emoji === "string" ? q.emoji : undefined,
            type: q.type === "text" ? ("text" as const) : ("multiple_choice" as const),
            options: Array.isArray(q.options)
              ? (q.options as Array<Record<string, unknown>>)
                  .map((o) => ({
                    id: String(o.id ?? ""),
                    label: String(o.label ?? ""),
                    emoji: typeof o.emoji === "string" ? o.emoji : undefined,
                  }))
                  .filter((o) => o.id && o.label)
              : undefined,
            placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
          })).filter((q) => q.id && q.question)
        );
        setWizardIndex(0);
        setWizardAnswers((prev) => {
          const next: Record<string, string> = { ...prev };
          for (const q of data.questions as Array<{ id: string }>) {
            if (!next[q.id] && priorRefinementAnswers[q.id]) {
              next[q.id] = priorRefinementAnswers[q.id];
            }
          }
          return next;
        });
        return true;
      }
      if (options?.autoGenerateIfEmpty) {
        await runEstimateGeneration();
      }
      return false;
    } finally {
      setLoadingWizard(false);
    }
  }

  async function runEstimateGeneration() {
    setGenerating(true);
    try {
      const mergedAnswers = { ...priorRefinementAnswers, ...wizardAnswers };
      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          estimatePrompt: estimatePrompt.trim() || undefined,
          refinementAnswers: mergedAnswers,
          overrides,
        }),
      });
      if (res.ok) {
        setWizardQuestions([]);
        setWizardIndex(0);
        setWizardAnswers({});
        router.refresh();
      }
    } finally {
      setGenerating(false);
    }
  }

  async function generateEstimate(options?: { skipWizard?: boolean; autoRefine?: boolean }) {
    if (options?.autoRefine) {
      await fetchEstimateWizard({ autoGenerateIfEmpty: true });
      return;
    }
    if (!options?.skipWizard && wizardQuestions.length === 0 && !estimatePrompt.trim()) {
      const opened = await fetchEstimateWizard();
      if (opened) return;
    }
    await runEstimateGeneration();
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
          <Button onClick={() => generateEstimate({ autoRefine: true })} disabled={generating || loadingWizard} className="gap-2">
            <Sparkles className="size-4" />
            {generating || loadingWizard ? "Generating..." : "Generate Estimate"}
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
  const activeQuestion = wizardQuestions[wizardIndex];
  const activeAnswer = activeQuestion ? (wizardAnswers[activeQuestion.id] ?? "") : "";
  const totalWizard = wizardQuestions.length;
  const canContinue =
    !!activeQuestion &&
    (activeQuestion.type === "multiple_choice"
      ? activeAnswer.trim().length > 0
      : activeAnswer.trim().length > 0);

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
            <Button size="sm" variant="outline" onClick={() => generateEstimate({ autoRefine: true })} disabled={generating || loadingWizard} className="gap-1.5">
              <RefreshCw className={`size-3.5 ${generating ? "animate-spin" : ""}`} />
              {generating || loadingWizard ? "Updating..." : "Regenerate"}
            </Button>
            <Badge variant="secondary" className="capitalize">{estimate.status}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <p className="text-xs font-medium text-slate-600">Estimate refinement (optional)</p>
          <Textarea
            value={estimatePrompt}
            onChange={(e) => setEstimatePrompt(e.target.value)}
            rows={2}
            className="bg-white"
            placeholder="Add context for this estimate (e.g. partial bathroom refresh, not full gut; heated floor only in kitchen)."
          />
          {activeQuestion && (
            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-500">
                  Question {wizardIndex + 1} of {totalWizard}
                </p>
                <span className="text-xs text-slate-400">{activeQuestion.emoji ?? "🧠"}</span>
              </div>
              <p className="text-sm text-slate-800 font-medium">{activeQuestion.question}</p>

              {activeQuestion.type === "multiple_choice" && activeQuestion.options && activeQuestion.options.length > 1 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {activeQuestion.options.map((opt) => {
                    const selected = activeAnswer === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() =>
                          setWizardAnswers((prev) => ({ ...prev, [activeQuestion.id]: opt.id }))
                        }
                        className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                          selected
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 hover:border-slate-300 bg-white text-slate-700"
                        }`}
                      >
                        <span className="mr-1.5">{opt.emoji ?? "•"}</span>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Input
                  value={activeAnswer}
                  onChange={(e) =>
                    setWizardAnswers((prev) => ({ ...prev, [activeQuestion.id]: e.target.value }))
                  }
                  placeholder={activeQuestion.placeholder ?? "Answer..."}
                  className="h-9 bg-white"
                />
              )}

              <div className="flex items-center justify-between">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setWizardIndex((i) => Math.max(0, i - 1))}
                  disabled={wizardIndex === 0}
                  className="gap-1"
                >
                  <ArrowLeft className="size-3.5" />
                  Back
                </Button>

                {wizardIndex < totalWizard - 1 ? (
                  <Button
                    size="sm"
                    onClick={() => setWizardIndex((i) => Math.min(totalWizard - 1, i + 1))}
                    disabled={!canContinue}
                    className="gap-1"
                  >
                    Next
                    <ArrowRight className="size-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => generateEstimate({ skipWizard: true })}
                    disabled={!canContinue || generating || loadingWizard}
                  >
                    Apply and regenerate
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { void fetchEstimateWizard(); }} disabled={loadingWizard || generating}>
              {loadingWizard ? "Loading questions..." : "Refine inputs"}
            </Button>
            <Button size="sm" onClick={() => generateEstimate({ skipWizard: true })} disabled={generating || loadingWizard}>
              {generating ? "Updating..." : "Regenerate with refinement"}
            </Button>
          </div>
        </div>

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

        {!!estimate?.lines.length && (
          <div className="rounded-lg border border-slate-200 p-3 space-y-3">
            <p className="text-xs font-medium text-slate-600">Manual cost overrides</p>
            <div className="space-y-2 max-h-64 overflow-auto pr-1">
              {estimate.lines.map((line) => (
                <div key={line.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs border border-slate-100 rounded p-2">
                  <div className="md:col-span-4 text-slate-700 font-medium truncate">{line.scopeItem.segment} — {line.scopeItem.task}</div>
                  <Input
                    type="number"
                    value={overrides[line.scopeItemId]?.quantity ?? line.quantity ?? 0}
                    onChange={(e) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [line.scopeItemId]: {
                          ...prev[line.scopeItemId],
                          quantity: parseFloat(e.target.value) || 0,
                        },
                      }))
                    }
                    className="h-8"
                    placeholder="Qty"
                  />
                  <Input
                    type="number"
                    value={overrides[line.scopeItemId]?.materialUnitCost ?? line.materialUnitCost ?? 0}
                    onChange={(e) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [line.scopeItemId]: {
                          ...prev[line.scopeItemId],
                          materialUnitCost: parseFloat(e.target.value) || 0,
                        },
                      }))
                    }
                    className="h-8"
                    placeholder="Mat $/unit"
                  />
                  <Input
                    type="number"
                    value={overrides[line.scopeItemId]?.laborHours ?? line.laborHours ?? 0}
                    onChange={(e) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [line.scopeItemId]: {
                          ...prev[line.scopeItemId],
                          laborHours: parseFloat(e.target.value) || 0,
                        },
                      }))
                    }
                    className="h-8"
                    placeholder="Labor hrs"
                  />
                  <Input
                    value={overrides[line.scopeItemId]?.materialName ?? line.materialName ?? ""}
                    onChange={(e) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [line.scopeItemId]: {
                          ...prev[line.scopeItemId],
                          materialName: e.target.value,
                        },
                      }))
                    }
                    className="h-8"
                    placeholder="Material label"
                  />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Overrides apply when you click <span className="font-medium">Regenerate with refinement</span>.
            </p>
          </div>
        )}

        {lineWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
            <p className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" />
              Estimate quality warnings
            </p>
            <ul className="space-y-1">
              {lineWarnings.map((w, i) => (
                <li key={`${w}-${i}`} className="text-xs text-amber-700">{w}</li>
              ))}
            </ul>
          </div>
        )}

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
