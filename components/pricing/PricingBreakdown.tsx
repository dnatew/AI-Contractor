"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
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

type PricePoint = "low" | "medium" | "high";

type AiLoadingMode =
  | "wizard"
  | "estimate"
  | "reprice"
  | "deepDiveQuestions"
  | "deepDiveRun"
  | "laborSearch";

const AI_LOADING_META: Record<
  AiLoadingMode,
  {
    title: string;
    description: string;
    gifPath: string;
    statuses: string[];
  }
> = {
  wizard: {
    title: "Preparing AI questions",
    description: "Building a short questionnaire to refine pricing decisions.",
    gifPath: "/uploads/typing-cat-typing.gif",
    statuses: ["Reading your project context...", "Drafting targeted questions...", "Finalizing prompts..."],
  },
  estimate: {
    title: "Generating estimate",
    description: "Combining scope, labor signals, and material logic.",
    gifPath: "/uploads/typing-cat-typing.gif",
    statuses: ["Analyzing scope items...", "Blending labor and material rates...", "Assembling line items..."],
  },
  reprice: {
    title: "Checking cost numbers",
    description: "Re-checking item costs with supplier-backed signals.",
    gifPath: "/uploads/typing-cat-typing.gif",
    statuses: ["Reviewing current estimate...", "Comparing pricing evidence...", "Updating material assumptions..."],
  },
  deepDiveQuestions: {
    title: "Preparing deep dive",
    description: "Generating focused questions for this estimate line.",
    gifPath: "/uploads/typing-cat-typing.gif",
    statuses: ["Understanding this line item...", "Building targeted follow-ups...", "Preparing your deep dive..."],
  },
  deepDiveRun: {
    title: "Running AI deep dive",
    description: "Researching this item and updating supporting references.",
    gifPath: "/uploads/typing-cat-typing.gif",
    statuses: ["Searching relevant sources...", "Comparing cost scenarios...", "Writing insights and links..."],
  },
  laborSearch: {
    title: "Searching labor rates",
    description: "Pulling area/province signals for sqft labor benchmarks.",
    gifPath: "/uploads/typing-cat-typing.gif",
    statuses: ["Finding local labor references...", "Normalizing rate formats...", "Preparing suggested ranges..."],
  },
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
}

function fmtShort(n: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

function perUnitLabel(unit?: string | null) {
  const u = (unit ?? "").trim();
  return u || "unit";
}

function AiLoadingModal({
  mode,
  open,
  onOpenChange,
}: {
  mode: AiLoadingMode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [statusIndex, setStatusIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setStatusIndex(0);
    setElapsedMs(0);
    setImageFailed(false);
    if (!open || !mode) return;
    const statusTimer = window.setInterval(() => {
      setStatusIndex((prev) => prev + 1);
    }, 1900);
    const elapsedTimer = window.setInterval(() => {
      setElapsedMs((prev) => prev + 500);
    }, 500);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(elapsedTimer);
    };
  }, [open, mode]);

  if (!mode) return null;
  const meta = AI_LOADING_META[mode];
  const status = meta.statuses[statusIndex % meta.statuses.length];
  const showSlowMessage = elapsedMs >= 12000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center justify-center min-h-40">
            {imageFailed ? (
              <div className="flex flex-col items-center gap-2 text-slate-500">
                <RefreshCw className="size-8 animate-spin" />
                <p className="text-xs">Loading animation unavailable</p>
              </div>
            ) : (
              <img
                src={meta.gifPath}
                alt={`${meta.title} animation`}
                className="max-h-32 w-auto object-contain"
                onError={() => setImageFailed(true)}
              />
            )}
          </div>
          <p className="text-sm text-slate-700 flex items-center gap-2">
            <RefreshCw className="size-3.5 animate-spin text-slate-500" />
            {status}
          </p>
          {showSlowMessage && (
            <p className="text-xs text-slate-500">Still working. Web-backed searches can take a bit longer.</p>
          )}
          <p className="text-[11px] text-slate-400">
            Tip: add your own GIFs in <code>/public/ai-loading</code> to customize each AI flow.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type InlineOverride = {
  quantity?: number;
  materialUnitCost?: number;
  laborHours?: number;
  laborRate?: number;
  laborUnitRate?: number;
};

function GroupedEstimateTable({
  lines,
  onApplyOverride,
  onEditItem,
  onDeepDiveItem,
  itemInsights,
}: {
  lines: FullLine[];
  onApplyOverride: (scopeItemId: string, override: InlineOverride) => Promise<void> | void;
  onEditItem: (line: FullLine) => void;
  onDeepDiveItem: (line: FullLine) => void;
  itemInsights: Record<string, { summary?: string; links?: Array<{ label: string; url: string; price?: number }>; imageUrl?: string }>;
}) {
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{
    id: string;
    field: "quantity" | "materialUnitCost" | "laborHours" | "laborRate" | "laborUnitRate";
  } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

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
                  const isSqftLine =
                    !!line.quantity && line.quantity > 0 && (line.unit ?? "").toLowerCase().includes("sqft");
                  const laborUnitRate = isSqftLine && line.quantity ? line.laborCost / line.quantity : null;

                  return (
                    <div
                      key={line.id}
                      className="group grid grid-cols-12 gap-2 px-3 py-2 rounded-lg border border-transparent hover:border-slate-200 hover:bg-slate-50/70 hover:shadow-sm transition-all items-start"
                    >
                      {/* Task + source */}
                      <div className="col-span-4">
                        <p className="text-sm text-slate-800">{line.scopeItem.task}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {line.pricingSource === "default" ? (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 border-slate-200 text-slate-500 rounded-full">
                              <Sparkles className="size-2 mr-0.5" />Default
                            </Badge>
                          ) : null}
                          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm">
                            <button
                              onClick={() => onEditItem(line)}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 transition-all hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm active:scale-[0.98]"
                              title="Open full item editor"
                            >
                              <Pen className="size-2.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => onDeepDiveItem(line)}
                              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 transition-all hover:-translate-y-px hover:border-blue-300 hover:bg-blue-100 hover:shadow-sm active:scale-[0.98]"
                              title="Run AI supplier-backed deep dive"
                            >
                              <Sparkles className="size-2.5" />
                              AI deep dive
                            </button>
                          </div>
                        </div>
                        {itemInsights[line.scopeItemId] && (
                          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 space-y-1">
                            <div className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-500">
                              <Package className="size-3" />
                              Product reference
                            </div>
                            <p className="text-[11px] text-slate-600">{itemInsights[line.scopeItemId].summary ?? "Supplier-backed item insight"}</p>
                            {itemInsights[line.scopeItemId].links && itemInsights[line.scopeItemId].links!.length > 0 && (
                              <div className="space-y-0.5">
                                {itemInsights[line.scopeItemId].links!.slice(0, 3).map((l, i) => (
                                  <a
                                    key={`${line.scopeItemId}-${i}`}
                                    href={l.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block text-[11px] text-blue-600 hover:underline"
                                  >
                                    {l.label}{typeof l.price === "number" ? ` — ${fmtShort(l.price)}` : ""}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <p className="mt-1 text-[10px] text-slate-400">
                          Tip: click quantity, labor rate, or material rate chips to edit quickly.
                        </p>
                      </div>

                      {/* Labor detail */}
                      <div className="col-span-3 text-right">
                        <p className="text-sm text-slate-700 tabular-nums">{fmt(line.laborCost)}</p>
                        {hasDetail && (
                          <div className="mt-0.5">
                            <p className="text-[11px] text-slate-400 tabular-nums flex items-center justify-end gap-1">
                            <Clock className="size-2.5" />
                            {(() => {
                              if (isSqftLine) {
                                if (editing && editing.id === line.scopeItemId && editing.field === "laborUnitRate") {
                                  return (
                                    <Input
                                      type="number"
                                      value={editingValue}
                                      onChange={(e) => setEditingValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          const v = parseFloat(editingValue);
                                          setEditing(null);
                                          setEditingValue("");
                                          onApplyOverride(line.scopeItemId, { laborUnitRate: Number.isFinite(v) ? v : 0 });
                                        } else if (e.key === "Escape") {
                                          setEditing(null);
                                          setEditingValue("");
                                        }
                                      }}
                                      onBlur={() => {
                                        setEditing(null);
                                        setEditingValue("");
                                      }}
                                      className="w-24 h-7 text-right"
                                      autoFocus
                                    />
                                  );
                                }
                                return (
                                  <button
                                    onClick={() => {
                                      setEditing({ id: line.scopeItemId, field: "laborUnitRate" });
                                      setEditingValue(String(laborUnitRate?.toFixed(2) ?? 0));
                                    }}
                                    className="text-[11px] text-slate-500 tabular-nums inline-flex items-center justify-end gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 hover:bg-slate-100"
                                    title="Click to edit labor rate per sqft"
                                  >
                                    <Pen className="size-2.5" />
                                    {Number(line.quantity ?? 0).toFixed(0)} sqft × ${Number(laborUnitRate ?? 0).toFixed(2)}/sqft
                                  </button>
                                );
                              }
                              if (editing && editing.id === line.scopeItemId && editing.field === "laborHours") {
                                return (
                                  <Input
                                    type="number"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        const v = parseFloat(editingValue);
                                        setEditing(null);
                                        setEditingValue("");
                                        onApplyOverride(line.scopeItemId, { laborHours: Number.isFinite(v) ? v : 0 });
                                      } else if (e.key === "Escape") {
                                        setEditing(null);
                                        setEditingValue("");
                                      }
                                    }}
                                    onBlur={() => {
                                      setEditing(null);
                                      setEditingValue("");
                                    }}
                                    className="w-20 h-7 text-right"
                                    autoFocus
                                  />
                                );
                              }
                              return (
                                <button
                                  onClick={() => {
                                    setEditing({ id: line.scopeItemId, field: "laborHours" });
                                    setEditingValue(String(line.laborHours ?? 0));
                                  }}
                                  className="text-[11px] text-slate-500 tabular-nums inline-flex items-center justify-end gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 hover:bg-slate-100"
                                  title="Click to edit labor hours for this line"
                                >
                                  <Pen className="size-2.5" />
                                  {line.laborHours!.toFixed(1)}h × ${line.laborRate!.toFixed(0)}/hr
                                </button>
                              );
                            })()}
                            </p>
                          {isSqftLine && (
                            <p className="text-[11px] text-slate-400 tabular-nums flex items-center justify-end gap-1 mt-0.5">
                              {editing && editing.id === line.scopeItemId && editing.field === "quantity" ? (
                                <Input
                                  type="number"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const v = parseFloat(editingValue);
                                      setEditing(null);
                                      setEditingValue("");
                                      onApplyOverride(line.scopeItemId, { quantity: Number.isFinite(v) ? v : 0 });
                                    } else if (e.key === "Escape") {
                                      setEditing(null);
                                      setEditingValue("");
                                    }
                                  }}
                                  onBlur={() => {
                                    setEditing(null);
                                    setEditingValue("");
                                  }}
                                  className="w-20 h-7 text-right"
                                />
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditing({ id: line.scopeItemId, field: "quantity" });
                                    setEditingValue(String(line.quantity ?? 0));
                                  }}
                                  className="text-[11px] text-slate-500 tabular-nums inline-flex items-center justify-end gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 hover:bg-slate-100"
                                  title="Click to edit labor sqft quantity"
                                >
                                  <Pen className="size-2.5" />
                                  {Number(line.quantity ?? 0).toFixed(0)} sqft
                                </button>
                              )}
                            </p>
                          )}
                          {!isSqftLine && (
                            <p className="text-[11px] text-slate-400 tabular-nums flex items-center justify-end gap-1 mt-0.5">
                              {editing && editing.id === line.scopeItemId && editing.field === "laborRate" ? (
                                <Input
                                  type="number"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const v = parseFloat(editingValue);
                                      setEditing(null);
                                      setEditingValue("");
                                      onApplyOverride(line.scopeItemId, { laborRate: Number.isFinite(v) ? v : 0 });
                                    } else if (e.key === "Escape") {
                                      setEditing(null);
                                      setEditingValue("");
                                    }
                                  }}
                                  onBlur={() => {
                                    setEditing(null);
                                    setEditingValue("");
                                  }}
                                  className="w-20 h-7 text-right"
                                />
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditing({ id: line.scopeItemId, field: "laborRate" });
                                    setEditingValue(String(line.laborRate ?? 0));
                                  }}
                                  className="text-[11px] text-slate-500 tabular-nums inline-flex items-center justify-end gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 hover:bg-slate-100"
                                  title="Click to edit labor hourly rate"
                                >
                                  <Pen className="size-2.5" />
                                  ${Number(line.laborRate ?? 0).toFixed(0)}/hr
                                </button>
                              )}
                            </p>
                          )}
                          </div>
                        )}
                      </div>

                      {/* Material detail */}
                      <div className="col-span-3 text-right">
                        <p className="text-sm text-slate-700 tabular-nums">{fmt(line.materialCost)}</p>
                        {hasDetail && (
                          <div className="mt-0.5">
                            <p className="text-[11px] text-slate-400 tabular-nums flex items-center justify-end gap-1">
                              <Package className="size-2.5" />
                              {editing && editing.id === line.scopeItemId && editing.field === "quantity" ? (
                                <Input
                                  type="number"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const v = parseFloat(editingValue);
                                      setEditing(null);
                                      setEditingValue("");
                                      onApplyOverride(line.scopeItemId, { quantity: Number.isFinite(v) ? v : 0 });
                                    } else if (e.key === "Escape") {
                                      setEditing(null);
                                      setEditingValue("");
                                    }
                                  }}
                                  onBlur={() => {
                                    setEditing(null);
                                    setEditingValue("");
                                  }}
                                  className="w-20 h-7 text-right"
                                  autoFocus
                                />
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditing({ id: line.scopeItemId, field: "quantity" });
                                    setEditingValue(String(line.quantity ?? 0));
                                  }}
                                  className="text-[11px] text-slate-500 tabular-nums inline-flex items-center justify-end gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 hover:bg-slate-100"
                                  title="Click to edit quantity for this line"
                                >
                                  <Pen className="size-2.5" />
                                  {line.quantity?.toFixed(0)} {line.unit} × ${line.materialUnitCost?.toFixed(2)}/{perUnitLabel(line.unit)}
                                </button>
                              )}
                            </p>
                            <p className="text-[11px] text-slate-400 tabular-nums flex items-center justify-end gap-1 mt-0.5">
                              {editing && editing.id === line.scopeItemId && editing.field === "materialUnitCost" ? (
                                <Input
                                  type="number"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const v = parseFloat(editingValue);
                                      setEditing(null);
                                      setEditingValue("");
                                      onApplyOverride(line.scopeItemId, { materialUnitCost: Number.isFinite(v) ? v : 0 });
                                    } else if (e.key === "Escape") {
                                      setEditing(null);
                                      setEditingValue("");
                                    }
                                  }}
                                  onBlur={() => {
                                    setEditing(null);
                                    setEditingValue("");
                                  }}
                                  className="w-24 h-7 text-right"
                                />
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditing({ id: line.scopeItemId, field: "materialUnitCost" });
                                    setEditingValue(String(line.materialUnitCost ?? 0));
                                  }}
                                  className="text-[11px] text-slate-500 tabular-nums inline-flex items-center justify-end gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 hover:bg-slate-100"
                                  title="Click to edit material cost per unit"
                                >
                                  <Pen className="size-2.5" />
                                  ${Number(line.materialUnitCost ?? 0).toFixed(2)}/{perUnitLabel(line.unit)}
                                </button>
                              )}
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
  const [pricePoint, setPricePoint] = useState<PricePoint>("medium");
  const [estimatePrompt, setEstimatePrompt] = useState("");
  const [wizardQuestions, setWizardQuestions] = useState<WizardQuestion[]>([]);
  const [wizardIndex, setWizardIndex] = useState(0);
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<
    Record<
      string,
      {
        quantity?: number;
        materialUnitCost?: number;
        laborHours?: number;
        laborRate?: number;
        laborUnitRate?: number;
        materialName?: string;
      }
    >
  >({});
  const [editLine, setEditLine] = useState<FullLine | null>(null);
  const [deepDiveLine, setDeepDiveLine] = useState<FullLine | null>(null);
  const [deepDiveQuestions, setDeepDiveQuestions] = useState<Array<{ id: string; question: string; placeholder?: string }>>([]);
  const [deepDiveAnswers, setDeepDiveAnswers] = useState<Record<string, string>>({});
  const [deepDiveLoadingQuestions, setDeepDiveLoadingQuestions] = useState(false);
  const [aiLoadingMode, setAiLoadingMode] = useState<AiLoadingMode | null>(null);
  const [showAiLoadingModal, setShowAiLoadingModal] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [editForm, setEditForm] = useState<{ task: string; material: string; quantity: number; laborHours: number; materialUnitCost: number } | null>(null);
  const [autoQuestionnaireLoaded, setAutoQuestionnaireLoaded] = useState(false);
  const [laborReviewOpen, setLaborReviewOpen] = useState(false);
  const [laborReviewAutoOpened, setLaborReviewAutoOpened] = useState(false);
  const [loadingLaborSuggestions, setLoadingLaborSuggestions] = useState(false);
  const [laborSuggestions, setLaborSuggestions] = useState<
    Array<{
      category?: string;
      key: string;
      label: string;
      suggestedRate: number;
      internetAvg?: number;
      savedRate?: number | null;
      rationale?: string;
      sources: Array<{ title: string; url: string }>;
      loading?: boolean;
      fetched?: boolean;
    }>
  >([]);
  const [laborDraft, setLaborDraft] = useState<Record<string, number>>({});
  const laborLoadIdRef = useRef(0);
  const [laborSearchError, setLaborSearchError] = useState<Record<string, string>>({});
  const [workingLines, setWorkingLines] = useState<FullLine[]>(estimate?.lines ?? []);
  const [regenDialogOpen, setRegenDialogOpen] = useState(false);
  const [regenSelection, setRegenSelection] = useState<Record<string, boolean>>({});

  const markupRate = useMemo(() => {
    const a = estimate?.assumptions as { markupPercent?: number } | null;
    const pct = typeof a?.markupPercent === "number" ? a.markupPercent : 15;
    return pct / 100;
  }, [estimate]);

  const inferredTaxRate = useMemo(() => {
    if (!estimate) return 0;
    const denom = estimate.totalLabor + estimate.totalMaterial + estimate.totalMarkup;
    return denom > 0 ? estimate.totalTax / denom : 0;
  }, [estimate]);

  const totals = useMemo(() => {
    const labor = workingLines.reduce((s, l) => s + l.laborCost, 0);
    const material = workingLines.reduce((s, l) => s + l.materialCost, 0);
    const markup = workingLines.reduce((s, l) => s + l.markup, 0);
    const tax = workingLines.reduce((s, l) => s + l.tax, 0);
    return { labor, material, markup, tax, grandTotal: labor + material + markup + tax };
  }, [workingLines]);

  function recomputeLine(line: FullLine, partial: InlineOverride): FullLine {
    const quantity = partial.quantity ?? line.quantity ?? 0;
    const laborRate = partial.laborRate ?? line.laborRate ?? 0;
    let laborHours = partial.laborHours ?? line.laborHours ?? 0;
    const materialUnitCost = partial.materialUnitCost ?? line.materialUnitCost ?? 0;
    const unitLower = (line.unit ?? "").toLowerCase();
    const isSqftLine = quantity > 0 && (unitLower.includes("sqft") || unitLower.includes("sq ft"));
    let laborCost = line.laborCost;
    if (isSqftLine) {
      const currentQty = line.quantity ?? 0;
      const currentLaborUnitRate = currentQty > 0 ? line.laborCost / currentQty : 0;
      const nextLaborUnitRate = partial.laborUnitRate ?? currentLaborUnitRate;
      if (nextLaborUnitRate > 0) laborCost = quantity * nextLaborUnitRate;
      else laborCost = laborHours * laborRate;
      if (laborRate > 0) laborHours = laborCost / laborRate;
    } else {
      laborCost = laborHours * laborRate;
    }
    const materialCost = quantity * materialUnitCost;
    const subtotal = laborCost + materialCost;
    const markup = subtotal * markupRate;
    const tax = (subtotal + markup) * inferredTaxRate;
    return {
      ...line,
      quantity,
      laborRate,
      laborHours,
      materialUnitCost,
      laborCost,
      materialCost,
      markup,
      tax,
    };
  }

  function beginAiLoading(mode: AiLoadingMode) {
    setAiLoadingMode(mode);
  }

  function endAiLoading(mode: AiLoadingMode) {
    setAiLoadingMode((current) => (current === mode ? null : current));
  }

  const lineWarnings: string[] = useMemo(() => {
    const a = estimate?.assumptions as { lineWarnings?: string[] } | null;
    if (!Array.isArray(a?.lineWarnings)) return [];
    return a.lineWarnings.filter((w): w is string => typeof w === "string");
  }, [estimate]);
  const hasLineWarnings = lineWarnings.length > 0;

  const priorRefinementAnswers = useMemo(() => {
    const a = estimate?.assumptions as { refinementAnswers?: Record<string, string> } | null;
    return (a?.refinementAnswers ?? {}) as Record<string, string>;
  }, [estimate]);
  const itemInsights = useMemo(() => {
    const a = estimate?.assumptions as {
      itemInsights?: Record<string, { summary?: string; links?: Array<{ label: string; url: string; price?: number }>; imageUrl?: string }>;
    } | null;
    return (a?.itemInsights ?? {}) as Record<string, { summary?: string; links?: Array<{ label: string; url: string; price?: number }>; imageUrl?: string }>;
  }, [estimate]);
  const repriceReferences = useMemo(() => {
    const a = estimate?.assumptions as {
      repriceReferences?: Array<{
        scopeItemId: string;
        task: string;
        materialUnitCost: number;
        notes?: string;
        links?: Array<{ label: string; url: string; price?: number }>;
      }>;
    } | null;
    return Array.isArray(a?.repriceReferences) ? a.repriceReferences : [];
  }, [estimate]);

  async function fetchEstimateWizard(options?: { autoGenerateIfEmpty?: boolean }) {
    beginAiLoading("wizard");
    setLoadingWizard(true);
    try {
      const mergedAnswers = { ...priorRefinementAnswers, ...wizardAnswers };
      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode: "questions",
          pricePoint,
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
      endAiLoading("wizard");
    }
  }

  async function runEstimateGeneration(options?: {
    customOverrides?: Record<string, InlineOverride & { materialName?: string }>;
  }) {
    beginAiLoading("estimate");
    setGenerating(true);
    try {
      const mergedAnswers = { ...priorRefinementAnswers, ...wizardAnswers };
      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          pricePoint,
          estimatePrompt: estimatePrompt.trim() || undefined,
          refinementAnswers: mergedAnswers,
          overrides: options?.customOverrides ?? overrides,
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
      endAiLoading("estimate");
    }
  }
 
  async function runReprice() {
    beginAiLoading("reprice");
    setGenerating(true);
    try {
      const mergedAnswers = { ...priorRefinementAnswers, ...wizardAnswers };
      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode: "reprice",
          pricePoint,
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
      } else {
        console.error("reprice failed", await res.text());
      }
    } finally {
      setGenerating(false);
      endAiLoading("reprice");
    }
  }

  async function generateEstimate(options?: { skipWizard?: boolean; autoRefine?: boolean; skipLaborReview?: boolean }) {
    if (!options?.skipLaborReview) {
      openLaborRateReview();
      return;
    }
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

  async function applyInlineOverride(scopeItemId: string, partial: InlineOverride) {
    setOverrides((prev) => {
      const next = { ...prev, [scopeItemId]: { ...(prev[scopeItemId] ?? {}), ...partial } };
      return next;
    });
    setWorkingLines((prev) =>
      prev.map((line) => (line.scopeItemId === scopeItemId ? recomputeLine(line, partial) : line))
    );
  }

  async function loadLaborSuggestions() {
    beginAiLoading("laborSearch");
    setLoadingLaborSuggestions(true);
    try {
      const requestId = Date.now();
      laborLoadIdRef.current = requestId;

      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, mode: "labor_rate_suggestions", pricePoint }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const categories = Array.isArray(data.categories) ? data.categories : [];
      const skeleton = categories.map((c: Record<string, unknown>) => ({
        category: String(c.category ?? ""),
        key: String(c.key ?? ""),
        label: String(c.label ?? ""),
        suggestedRate:
          typeof c.savedRate === "number" ? Number(c.savedRate) : 0,
        savedRate:
          typeof c.savedRate === "number" ? Number(c.savedRate) : null,
        sources: [] as Array<{ title: string; url: string }>,
        loading: false,
        fetched: false,
      }));
      setLaborSuggestions(skeleton);
      const draft: Record<string, number> = {};
      for (const s of skeleton) draft[s.key] = Number(s.suggestedRate) || 0;
      setLaborDraft(draft);
    } finally {
      setLoadingLaborSuggestions(false);
      endAiLoading("laborSearch");
    }
  }

  async function fetchLaborSuggestionForCategory(category: string, requestId?: number) {
    beginAiLoading("laborSearch");
    setLaborSearchError((prev) => ({ ...prev, [category]: "" }));
    setLaborSuggestions((prev) =>
      prev.map((x) => (x.category === category ? { ...x, loading: true } : x))
    );
    try {
      const r = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode: "labor_rate_suggestions",
          category,
          pricePoint,
        }),
      });
      if (requestId && laborLoadIdRef.current !== requestId) return;
      if (!r.ok) {
        setLaborSuggestions((prev) =>
          prev.map((x) => (x.category === category ? { ...x, loading: false } : x))
        );
        setLaborSearchError((prev) => ({ ...prev, [category]: "Search failed for this category." }));
        return;
      }
      const payload = await r.json();
      const s = payload.suggestion as {
        category?: string;
        key: string;
        label: string;
        suggestedRate: number;
        internetAvg?: number;
        savedRate?: number | null;
        rationale?: string;
        sources?: Array<{ title: string; url: string }>;
      };
      setLaborSuggestions((prev) =>
        prev.map((x) =>
          x.category === category
            ? {
                ...x,
                ...s,
                category: s.category ?? x.category,
                sources: Array.isArray(s.sources) ? s.sources : [],
                loading: false,
                fetched: true,
              }
            : x
        )
      );
      setLaborDraft((prev) => ({
        ...prev,
        [s.key]: Number.isFinite(s.suggestedRate) ? s.suggestedRate : prev[s.key] ?? 0,
      }));
    } finally {
      endAiLoading("laborSearch");
    }
  }

  function fallbackCategoryForSuggestion(s: { category?: string; key: string; label: string }) {
    if (s.category) return s.category;
    if (s.key.includes("floor")) return "flooring";
    if (s.key.includes("tile")) return "tiling";
    if (s.key.includes("drywall")) return "drywall";
    if (s.key.includes("paint") || s.key.includes("walls")) return "painting";
    if (s.key.includes("demo")) return "demolition";
    if (s.key.includes("kitchen")) return "kitchen";
    if (s.key.includes("bath")) return "bathroom";
    return "general";
  }

  async function confirmLaborRatesAndGenerate() {
    setSavingItem(true);
    try {
      for (const s of laborSuggestions) {
        const rate = laborDraft[s.key];
        if (!Number.isFinite(rate) || rate <= 0) continue;
        await fetch("/api/pricing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: s.key, rate, unit: "sqft" }),
        });
      }
      setLaborReviewOpen(false);
      await runEstimateGeneration();
    } finally {
      setSavingItem(false);
    }
  }

  function openLaborRateReview() {
    setLaborReviewOpen(true);
    if (laborSuggestions.length === 0) void loadLaborSuggestions();
  }

  function openRegenerateDialog() {
    const next: Record<string, boolean> = {};
    for (const line of workingLines) {
      next[line.scopeItemId] = !overrides[line.scopeItemId];
    }
    setRegenSelection(next);
    setRegenDialogOpen(true);
  }

  async function regenerateSelectedItems() {
    const selectedIds = new Set(
      Object.entries(regenSelection)
        .filter(([, checked]) => checked)
        .map(([id]) => id)
    );
    if (selectedIds.size === 0) {
      setRegenDialogOpen(false);
      return;
    }
    const customOverrides: Record<string, InlineOverride & { materialName?: string }> = { ...overrides };
    for (const id of selectedIds) {
      delete customOverrides[id];
    }
    for (const line of workingLines) {
      if (selectedIds.has(line.scopeItemId)) continue;
      const locked: InlineOverride & { materialName?: string } = {
        quantity: line.quantity ?? undefined,
        laborHours: line.laborHours ?? undefined,
        laborRate: line.laborRate ?? undefined,
        materialUnitCost: line.materialUnitCost ?? undefined,
        materialName: line.materialName ?? undefined,
      };
      const unitLower = (line.unit ?? "").toLowerCase();
      if ((unitLower.includes("sqft") || unitLower.includes("sq ft")) && (line.quantity ?? 0) > 0) {
        locked.laborUnitRate = line.laborCost / (line.quantity ?? 1);
      }
      customOverrides[line.scopeItemId] = { ...(customOverrides[line.scopeItemId] ?? {}), ...locked };
    }
    setRegenDialogOpen(false);
    await runEstimateGeneration({ customOverrides });
  }

  const activeQuestion = wizardQuestions[wizardIndex];
  const activeAnswer = activeQuestion ? (wizardAnswers[activeQuestion.id] ?? "") : "";
  const totalWizard = wizardQuestions.length;
  const canContinue =
    !!activeQuestion &&
    (activeQuestion.type === "multiple_choice"
      ? activeAnswer.trim().length > 0
      : activeAnswer.trim().length > 0);
  const deepDiveHasAtLeastOneAnswer = Object.values(deepDiveAnswers).some(
    (v) => typeof v === "string" && v.trim().length > 0
  );

  useEffect(() => {
    if (!estimate) {
      setWorkingLines([]);
      setRegenSelection({});
      return;
    }
    setWorkingLines(estimate.lines);
    const nextSelection: Record<string, boolean> = {};
    for (const l of estimate.lines) nextSelection[l.scopeItemId] = true;
    setRegenSelection(nextSelection);
  }, [estimate]);

  useEffect(() => {
    setShowAiLoadingModal(false);
    if (!aiLoadingMode) return;
    const timer = window.setTimeout(() => {
      setShowAiLoadingModal(true);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [aiLoadingMode]);

  useEffect(() => {
    if (estimate || autoQuestionnaireLoaded || loadingWizard || wizardQuestions.length > 0) return;
    setAutoQuestionnaireLoaded(true);
    void fetchEstimateWizard();
  }, [estimate, autoQuestionnaireLoaded, loadingWizard, wizardQuestions.length]);

  useEffect(() => {
    const a = estimate?.assumptions as { fallbackPricing?: { pricePoint?: PricePoint } } | null;
    const p = a?.fallbackPricing?.pricePoint;
    if (p === "low" || p === "medium" || p === "high") {
      setPricePoint(p);
    }
  }, [estimate]);

  useEffect(() => {
    if (estimate || laborReviewOpen || laborReviewAutoOpened) return;
    // first estimate flow: review online labor benchmarks before generating
    setLaborReviewAutoOpened(true);
    setLaborReviewOpen(true);
    void loadLaborSuggestions();
  }, [estimate, laborReviewOpen, laborReviewAutoOpened]);

  const laborReviewDialog = (
    <Dialog open={laborReviewOpen} onOpenChange={setLaborReviewOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Labor rate review</DialogTitle>
          <DialogDescription>
            7-8 online area/province rates + your saved settings. Pick quickly, slide, or set custom; then confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-600">Fallback pricing style</p>
          <div className="flex items-center gap-1">
            {(["low", "medium", "high"] as const).map((p) => {
              const selected = pricePoint === p;
              return (
                <button
                  key={p}
                  onClick={() => setPricePoint(p)}
                  className={`text-xs rounded-md px-2 py-1 border transition-colors ${
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-3 max-h-80 overflow-auto pr-1">
          {loadingLaborSuggestions && laborSuggestions.length === 0 ? (
            <p className="text-sm text-slate-500">Searching rates...</p>
          ) : laborSuggestions.length === 0 ? (
            <p className="text-sm text-slate-500">
              No suggestions loaded yet. Click <span className="font-medium">AI search</span> on an item, or set rates in <Link href="/settings" className="underline text-blue-600">Settings</Link>.
            </p>
          ) : (
            laborSuggestions.map((s) => {
              const avg =
                s.internetAvg && s.internetAvg > 0
                  ? s.internetAvg
                  : s.suggestedRate > 0
                    ? s.suggestedRate
                    : null;
              const saved = typeof s.savedRate === "number" ? s.savedRate : null;
              const current = laborDraft[s.key] ?? s.suggestedRate;
              const bubbleLow = avg ? Number((avg * 0.85).toFixed(2)) : null;
              const bubbleMid = avg ? Number(avg.toFixed(2)) : null;
              const bubbleHigh = avg ? Number((avg * 1.15).toFixed(2)) : null;
              return (
                <div key={s.key} className="rounded border border-slate-200 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-700">{s.label}</p>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const cat = fallbackCategoryForSuggestion(s);
                          void fetchLaborSuggestionForCategory(cat);
                        }}
                        disabled={!!s.loading}
                        className="h-8"
                      >
                        {s.loading ? "Searching..." : "AI search"}
                      </Button>
                      <Input
                        type="number"
                        className="w-28 h-8 text-right"
                        value={current}
                        onChange={(e) =>
                          setLaborDraft((prev) => ({ ...prev, [s.key]: parseFloat(e.target.value) || 0 }))
                        }
                      />
                    </div>
                  </div>
                  {avg ? (
                    <>
                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        {bubbleLow != null && (
                          <button
                            onClick={() => setLaborDraft((prev) => ({ ...prev, [s.key]: bubbleLow }))}
                            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50"
                          >
                            Low {bubbleLow}
                          </button>
                        )}
                        {bubbleMid != null && (
                          <button
                            onClick={() => setLaborDraft((prev) => ({ ...prev, [s.key]: bubbleMid }))}
                            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50"
                          >
                            Internet avg {bubbleMid}
                          </button>
                        )}
                        {bubbleHigh != null && (
                          <button
                            onClick={() => setLaborDraft((prev) => ({ ...prev, [s.key]: bubbleHigh }))}
                            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50"
                          >
                            High {bubbleHigh}
                          </button>
                        )}
                        {saved != null && (
                          <button
                            onClick={() => setLaborDraft((prev) => ({ ...prev, [s.key]: saved }))}
                            className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          >
                            Saved {saved}
                          </button>
                        )}
                      </div>
                      <input
                        type="range"
                        min={Math.max(0.5, avg * 0.5)}
                        max={Math.max(2, avg * 1.8)}
                        step={0.05}
                        value={current}
                        onChange={(e) =>
                          setLaborDraft((prev) => ({ ...prev, [s.key]: parseFloat(e.target.value) || 0 }))
                        }
                        className="w-full"
                      />
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">No internet average loaded yet. Click AI search.</p>
                  )}
                  {s.loading && <p className="text-xs text-slate-500">Searching web + LLM for this category...</p>}
                  {!s.loading && !s.fetched && (
                    <p className="text-xs text-slate-500">No live search yet. Click AI search to fetch web-backed rates.</p>
                  )}
                  {!!laborSearchError[fallbackCategoryForSuggestion(s)] && (
                    <p className="text-xs text-rose-600">{laborSearchError[fallbackCategoryForSuggestion(s)]}</p>
                  )}
                  {s.rationale && <p className="text-xs text-slate-500">{s.rationale}</p>}
                  {s.sources?.length > 0 && (
                    <div className="space-y-0.5">
                      {s.sources.slice(0, 3).map((src, i) => (
                        <a key={`${s.key}-${i}`} href={src.url} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 hover:underline">
                          {src.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setLaborReviewOpen(false)}>Close</Button>
          <Button onClick={() => { void confirmLaborRatesAndGenerate(); }} disabled={savingItem || loadingLaborSuggestions}>
            {savingItem ? "Saving..." : "Confirm rates + run estimate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const aiLoadingDialog = (
    <AiLoadingModal
      mode={aiLoadingMode}
      open={showAiLoadingModal && !!aiLoadingMode}
      onOpenChange={setShowAiLoadingModal}
    />
  );

  const pricePointSelector = (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-600">Fallback pricing</p>
      <div className="flex items-center gap-1">
        {(["low", "medium", "high"] as const).map((p) => {
          const selected = pricePoint === p;
          return (
            <button
              key={p}
              onClick={() => setPricePoint(p)}
              className={`text-xs rounded-md px-2 py-1 border transition-colors ${
                selected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          );
        })}
      </div>
    </div>
  );

  async function openEditItem(line: FullLine) {
    setEditLine(line);
    setEditForm({
      task: line.scopeItem.task,
      material: line.scopeItem.material,
      quantity: line.quantity ?? 0,
      laborHours: line.laborHours ?? 0,
      materialUnitCost: line.materialUnitCost ?? 0,
    });
  }

  async function saveItemEdits() {
    if (!editLine || !editForm) return;
    setSavingItem(true);
    try {
      await fetch(`/api/scope/${editLine.scopeItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: editForm.task,
          material: editForm.material,
          quantity: editForm.quantity,
          laborHours: editForm.laborHours,
        }),
      });
      setOverrides((prev) => ({
        ...prev,
        [editLine.scopeItemId]: {
          ...(prev[editLine.scopeItemId] ?? {}),
          quantity: editForm.quantity,
          laborHours: editForm.laborHours,
          materialUnitCost: editForm.materialUnitCost,
          materialName: editForm.material,
        },
      }));
      setWorkingLines((prev) =>
        prev.map((line) => {
          if (line.scopeItemId !== editLine.scopeItemId) return line;
          const updated = recomputeLine(line, {
            quantity: editForm.quantity,
            laborHours: editForm.laborHours,
            materialUnitCost: editForm.materialUnitCost,
          });
          return {
            ...updated,
            materialName: editForm.material,
            scopeItem: {
              ...updated.scopeItem,
              task: editForm.task,
              material: editForm.material,
            },
          };
        })
      );
      setEditLine(null);
      setEditForm(null);
    } finally {
      setSavingItem(false);
    }
  }

  async function openDeepDive(line: FullLine) {
    beginAiLoading("deepDiveQuestions");
    setDeepDiveLine(line);
    setDeepDiveAnswers({});
    setDeepDiveQuestions([]);
    setDeepDiveLoadingQuestions(true);
    try {
      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode: "item_questions",
          scopeItemId: line.scopeItemId,
          pricePoint,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.questions)) {
          setDeepDiveQuestions(
            (data.questions as Array<Record<string, unknown>>)
              .map((q) => ({
                id: String(q.id ?? ""),
                question: String(q.question ?? ""),
                placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
              }))
              .filter((q) => q.id && q.question)
          );
        }
      }
    } finally {
      setDeepDiveLoadingQuestions(false);
      endAiLoading("deepDiveQuestions");
    }
  }

  async function runItemDeepDive() {
    if (!deepDiveLine) return;
    const hasAtLeastOneAnswer = Object.values(deepDiveAnswers).some(
      (v) => typeof v === "string" && v.trim().length > 0
    );
    if (deepDiveQuestions.length > 0 && !hasAtLeastOneAnswer) {
      return;
    }
    beginAiLoading("deepDiveRun");
    setSavingItem(true);
    try {
      const res = await fetch("/api/estimates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode: "item_reprice",
          scopeItemId: deepDiveLine.scopeItemId,
          pricePoint,
          itemAnswers: deepDiveAnswers,
          estimatePrompt: estimatePrompt.trim() || undefined,
          refinementAnswers: { ...priorRefinementAnswers, ...wizardAnswers },
          overrides,
        }),
      });
      if (res.ok) {
        setDeepDiveLine(null);
        setDeepDiveQuestions([]);
        setDeepDiveAnswers({});
        router.refresh();
      }
    } finally {
      setSavingItem(false);
      endAiLoading("deepDiveRun");
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
        <CardContent className="space-y-3">
          {activeQuestion ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
              <p className="text-[11px] text-slate-500">
                Quick questionnaire · {wizardIndex + 1} of {totalWizard}
              </p>
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
                >
                  Back
                </Button>
                {wizardIndex < totalWizard - 1 ? (
                  <Button
                    size="sm"
                    onClick={() => setWizardIndex((i) => Math.min(totalWizard - 1, i + 1))}
                    disabled={!canContinue}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => generateEstimate({ skipWizard: true, skipLaborReview: true })}
                    disabled={!canContinue || generating || loadingWizard}
                  >
                    Generate estimate
                  </Button>
                )}
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              onClick={() => {
                openLaborRateReview();
              }}
              disabled={generating || loadingWizard}
              className="gap-2"
            >
              <Sparkles className="size-4" />
              {generating || loadingWizard ? "Generating..." : "Review rates + generate"}
            </Button>
            <Button variant="outline" onClick={() => { void fetchEstimateWizard(); }} disabled={loadingWizard || generating}>
              {loadingWizard ? "Loading..." : "Quick questionnaire"}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Uses scope items first, checks description for gaps, and references your settings where applicable.
          </p>
          {pricePointSelector}
          {laborReviewDialog}
          {aiLoadingDialog}
        </CardContent>
      </Card>
    );
  }

  const assumptions = estimate.assumptions as {
    laborRate?: number;
    taxName?: string;
    markupPercent?: number;
    aiDebug?: {
      model?: string;
      generatedAt?: string;
      context?: unknown;
    };
    searchEvidence?: {
      provider?: string;
      laborBenchmarkQueries?: number;
      laborBenchmarkHits?: number;
      supplierQueries?: number;
      supplierHits?: number;
    };
  } | null;
  const userLines = workingLines.filter((l) => l.pricingSource === "user").length;
  const totalLines = workingLines.length;

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
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                openRegenerateDialog();
              }}
              disabled={generating || loadingWizard}
              className="gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${generating ? "animate-spin" : ""}`} />
              {generating || loadingWizard ? "Updating..." : "Regenerate selected"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => runReprice()} disabled={generating || loadingWizard} className="gap-1.5">
              <Package className="size-3.5" />
              {generating ? "Checking..." : "Check cost numbers"}
            </Button>
            <Badge variant="secondary" className="capitalize">{estimate.status}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {laborReviewDialog}
        {aiLoadingDialog}
        {pricePointSelector}
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
        </div>

        {/* Assumptions bar */}
        {assumptions && (
          <div className="flex flex-wrap gap-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            <span className="flex items-center gap-1"><Clock className="size-3" /> labor benchmarked by sqft + saved rates</span>
            <span className="text-slate-300">·</span>
            <span>{assumptions.markupPercent}% markup</span>
            <span className="text-slate-300">·</span>
            <span>{assumptions.taxName}</span>
          </div>
        )}

        {/* Grouped table */}
        <GroupedEstimateTable
          lines={workingLines}
          onApplyOverride={applyInlineOverride}
          onEditItem={openEditItem}
          onDeepDiveItem={openDeepDive}
          itemInsights={itemInsights}
        />

        {repriceReferences.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-medium text-slate-600">Price-check references</p>
            <div className="space-y-2 max-h-48 overflow-auto pr-1">
              {repriceReferences.map((ref) => (
                <div key={ref.scopeItemId} className="text-xs border border-slate-100 rounded p-2">
                  <p className="font-medium text-slate-700">{ref.task}</p>
                  <p className="text-slate-500">Suggested material unit: {fmtShort(ref.materialUnitCost)}</p>
                  {ref.notes && <p className="text-slate-500">{ref.notes}</p>}
                  {ref.links && ref.links.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {ref.links.map((l, i) => (
                        <a
                          key={`${ref.scopeItemId}-${i}`}
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-blue-600 hover:underline"
                        >
                          {l.label}{typeof l.price === "number" ? ` — ${fmtShort(l.price)}` : ""}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <Dialog open={!!editLine} onOpenChange={(o) => !o && setEditLine(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit estimate item</DialogTitle>
              <DialogDescription>Update title, description/material, and pricing values for this item.</DialogDescription>
            </DialogHeader>
            {editForm && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">Item title</p>
                  <Input value={editForm.task} onChange={(e) => setEditForm({ ...editForm, task: e.target.value })} placeholder="Item title" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">Material / description</p>
                  <Input value={editForm.material} onChange={(e) => setEditForm({ ...editForm, material: e.target.value })} placeholder="Description / material" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">Quantity</p>
                    <Input type="number" value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) || 0 })} placeholder="Qty" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">Labor hours</p>
                    <Input type="number" value={editForm.laborHours} onChange={(e) => setEditForm({ ...editForm, laborHours: parseFloat(e.target.value) || 0 })} placeholder="Labor hrs" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">Material cost per unit</p>
                    <Input type="number" value={editForm.materialUnitCost} onChange={(e) => setEditForm({ ...editForm, materialUnitCost: parseFloat(e.target.value) || 0 })} placeholder="Mat $/unit" />
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditLine(null)}>Cancel</Button>
              <Button onClick={() => { void saveItemEdits(); }} disabled={savingItem}>
                {savingItem ? "Saving..." : "Save item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deepDiveLine} onOpenChange={(o) => !o && setDeepDiveLine(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>AI deep dive (single item)</DialogTitle>
              <DialogDescription>
                This runs a focused Home Depot/RONA-backed search for this item and updates its pricing + references.
              </DialogDescription>
            </DialogHeader>
            {deepDiveLine && (
              <p className="text-xs text-slate-600">
                {deepDiveLine.scopeItem.segment} — {deepDiveLine.scopeItem.task}
              </p>
            )}
            <div className="space-y-2 max-h-64 overflow-auto pr-1">
              {deepDiveLoadingQuestions && (
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <RefreshCw className="size-3.5 animate-spin" />
                  Generating questions...
                </p>
              )}
              {deepDiveQuestions.map((q) => (
                <div key={q.id} className="space-y-1">
                  <p className="text-xs text-slate-600">{q.question}</p>
                  <Input
                    value={deepDiveAnswers[q.id] ?? ""}
                    onChange={(e) => setDeepDiveAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder={q.placeholder ?? "Answer..."}
                  />
                </div>
              ))}
              {!deepDiveLoadingQuestions && deepDiveQuestions.length === 0 && (
                <p className="text-xs text-slate-500">No extra questions were generated. You can still run deep dive now.</p>
              )}
              {!deepDiveLoadingQuestions && deepDiveQuestions.length > 0 && !deepDiveHasAtLeastOneAnswer && (
                <p className="text-xs text-amber-600">Answer at least one question to continue.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeepDiveLine(null)}>Cancel</Button>
              <Button
                onClick={() => { void runItemDeepDive(); }}
                disabled={savingItem || deepDiveLoadingQuestions || (deepDiveQuestions.length > 0 && !deepDiveHasAtLeastOneAnswer)}
              >
                {savingItem ? "Running deep dive..." : "Run deep dive"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={regenDialogOpen} onOpenChange={setRegenDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Regenerate selected line items</DialogTitle>
              <DialogDescription>
                Check the lines you want AI to recalculate. Unchecked lines stay locked to your current manual values.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-72 overflow-auto pr-1">
              {workingLines.map((line) => (
                <label key={`regen-${line.scopeItemId}`} className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!regenSelection[line.scopeItemId]}
                    onChange={(e) =>
                      setRegenSelection((prev) => ({ ...prev, [line.scopeItemId]: e.target.checked }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    {line.scopeItem.segment} — {line.scopeItem.task}
                  </span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  const allOff: Record<string, boolean> = {};
                  for (const l of workingLines) allOff[l.scopeItemId] = false;
                  setRegenSelection(allOff);
                }}
              >
                Clear all
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const allOn: Record<string, boolean> = {};
                  for (const l of workingLines) allOn[l.scopeItemId] = true;
                  setRegenSelection(allOn);
                }}
              >
                Select all
              </Button>
              <Button onClick={() => { void regenerateSelectedItems(); }} disabled={generating}>
                {generating ? "Regenerating..." : "Regenerate checked"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {hasLineWarnings ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
            <p className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" />
              Estimate quality warnings
            </p>
            <ul className="space-y-1">
              {lineWarnings.map((w, i) => (
                <li key={`${String(w)}-${i}`} className="text-xs text-amber-700">{String(w)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {assumptions?.searchEvidence && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-600">Evidence usage</p>
            <p className="text-xs text-slate-500 mt-1">
              {(assumptions.searchEvidence.provider ?? "web search")} ·
              labor queries {assumptions.searchEvidence.laborBenchmarkQueries ?? 0} (hits {assumptions.searchEvidence.laborBenchmarkHits ?? 0}) ·
              supplier queries {assumptions.searchEvidence.supplierQueries ?? 0} (hits {assumptions.searchEvidence.supplierHits ?? 0})
            </p>
          </div>
        )}
        {process.env.NODE_ENV !== "production" && !!assumptions?.aiDebug?.context && (
          <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <summary className="text-xs font-medium text-slate-700 cursor-pointer">
              AI debug snapshot (dev)
            </summary>
            <p className="text-[11px] text-slate-500 mt-2">
              Model: {assumptions.aiDebug.model ?? "n/a"}
              {assumptions.aiDebug.generatedAt ? ` · ${new Date(assumptions.aiDebug.generatedAt).toLocaleString()}` : ""}
            </p>
            <pre className="mt-2 text-[11px] text-slate-700 bg-white border border-slate-200 rounded p-2 overflow-auto max-h-72">
{JSON.stringify(assumptions.aiDebug.context, null, 2)}
            </pre>
          </details>
        )}

        {/* Totals */}
        <div className="border-t border-slate-200 pt-4 space-y-1.5">
          <div className="flex justify-between text-sm text-slate-600">
            <span className="flex items-center gap-1.5"><Clock className="size-3.5" /> Labor</span>
            <span className="tabular-nums">{fmt(totals.labor)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span className="flex items-center gap-1.5"><Package className="size-3.5" /> Materials</span>
            <span className="tabular-nums">{fmt(totals.material)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>Markup ({assumptions?.markupPercent ?? 15}%)</span>
            <span className="tabular-nums">{fmt(totals.markup)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>Tax ({assumptions?.taxName})</span>
            <span className="tabular-nums">{fmt(totals.tax)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-slate-900 pt-2 border-t border-slate-200">
            <span>Total</span>
            <span className="tabular-nums">{fmt(totals.grandTotal)}</span>
          </div>

          {/* Value tracking */}
          {showValueTracking && workingLines.length > 0 && (() => {
            const quoteAmount = estimate.confirmedAmount ?? totals.grandTotal;
            let valueCompleted = 0;
            for (const line of workingLines) {
              const lineTotal = line.laborCost + line.materialCost + line.markup + line.tax;
              const pct = (line.scopeItem.progressPercent ?? 0) / 100;
              valueCompleted += lineTotal * pct;
            }
            const valueOutstanding = Math.max(0, quoteAmount - valueCompleted);
            const hasProgress = workingLines.some((l) => (l.scopeItem.progressPercent ?? 0) > 0);
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
