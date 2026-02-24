"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUserProperties, type UserProperty } from "@/hooks/useUserProperties";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp,
  Home,
  Search,
  BarChart3,
  Sparkles,
  ExternalLink,
  MessageSquare,
  MapPin as MapPinIcon,
  Plus,
  Trash2,
  DollarSign,
  ArrowLeftRight,
} from "lucide-react";
import type { ScopeItem } from "@prisma/client";
import { DynamicComparablesMap } from "./DynamicMap";
import type { MapPin } from "./ComparablesMap";

type RealEstatePanelProps = {
  projectId: string;
  address: string;
  province: string;
  sqft: string;
  neighborhoodTier?: string | null;
  scopeItems: ScopeItem[];
};

type BreakdownItem = {
  renovation: string;
  estimatedAdd: number;
  percentOfFullReno?: number;
  roi?: number;
  notes: string;
};

type ComparableProperty = {
  address: string;
  price: number;
  sqft?: number;
  renovated?: boolean;
  notes: string;
  weight?: "local" | "reference";
  weightReason?: string;
};

type ValueAdjustment = {
  factor: string;
  valueDifference: number;
  notes: string;
};

type PropertyFeature = {
  key: string;
  icon: string;
  label: string;
  category: "structure" | "interior" | "exterior" | "reno";
};

const PROPERTY_FEATURES: PropertyFeature[] = [
  { key: "garage", icon: "🚗", label: "Garage", category: "structure" },
  { key: "basement_finished", icon: "🏠", label: "Finished basement", category: "structure" },
  { key: "basement_unfinished", icon: "🧱", label: "Unfinished basement", category: "structure" },
  { key: "extra_bedroom", icon: "🛏️", label: "3+ bedrooms", category: "structure" },
  { key: "two_bath", icon: "🚿", label: "2+ bathrooms", category: "structure" },
  { key: "new_kitchen", icon: "🍳", label: "Updated kitchen", category: "reno" },
  { key: "new_bathroom", icon: "🛁", label: "Updated bathroom", category: "reno" },
  { key: "new_flooring", icon: "🪵", label: "New flooring", category: "reno" },
  { key: "new_paint", icon: "🎨", label: "Fresh paint", category: "reno" },
  { key: "new_roof", icon: "🏗️", label: "New roof", category: "exterior" },
  { key: "new_windows", icon: "🪟", label: "New windows", category: "exterior" },
  { key: "deck_patio", icon: "🌳", label: "Deck / patio", category: "exterior" },
  { key: "fenced_yard", icon: "🏡", label: "Fenced yard", category: "exterior" },
  { key: "central_air", icon: "❄️", label: "Central air", category: "interior" },
  { key: "fireplace", icon: "🔥", label: "Fireplace", category: "interior" },
  { key: "open_concept", icon: "📐", label: "Open concept", category: "interior" },
];

type ComparablesResult = {
  estimatedValueAdd?: number;
  estimatedPercentIncrease?: number;
  valueAddRange?: [number, number];
  percentRange?: [number, number];
  confidence?: string;
  comparablesSummary?: string;
  breakdown?: BreakdownItem[];
  comparables?: ComparableProperty[];
  adjustments?: ValueAdjustment[];
  caveats?: string;
  usedWebSearch?: boolean;
  mapPins?: MapPin[];
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function RealEstatePanel({
  projectId,
  address,
  province,
  sqft,
  neighborhoodTier,
  scopeItems,
}: RealEstatePanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComparablesResult | null>(null);
  const [showClarify, setShowClarify] = useState(false);
  const [clarifications, setClarifications] = useState<Record<string, string>>({});
  const {
    properties: userComps,
    addProperty,
    updateProperty: updateUserComp,
    toggleFeature,
    removeProperty: removeUserComp,
    saveProperty,
  } = useUserProperties();
  const [showUserComps, setShowUserComps] = useState(false);
  const [expandedComp, setExpandedComp] = useState<string | null>(null);

  async function addUserComp() {
    const prop = await addProperty();
    if (prop) {
      setExpandedComp(prop.id);
      setShowUserComps(true);
    }
  }

  function bestPrice(c: UserProperty) {
    return c.salePrice > 0 ? c.salePrice : c.purchasePrice;
  }

  const autoAdjustments = useMemo(() => {
    const filled = userComps.filter((c) => bestPrice(c) > 0);
    if (filled.length < 2) return [];
    const diffs: { label: string; diff: number; detail: string; equity?: number }[] = [];

    for (const c of filled) {
      if (c.purchasePrice > 0 && c.salePrice > 0) {
        const equity = c.salePrice - c.purchasePrice;
        const label = c.description || "Property";
        diffs.push({
          label: `📈 ${label} — equity gained`,
          diff: equity,
          detail: `Bought ${formatCurrency(c.purchasePrice)}${c.purchaseDate ? ` (${c.purchaseDate})` : ""} → Sold ${formatCurrency(c.salePrice)}${c.saleDate ? ` (${c.saleDate})` : ""}${c.renoWork ? `. Reno: ${c.renoWork}` : ""}`,
          equity,
        });
      }
    }

    for (let i = 0; i < filled.length; i++) {
      for (let j = i + 1; j < filled.length; j++) {
        const a = filled[i], b = filled[j];
        const aVal = bestPrice(a), bVal = bestPrice(b);
        const priceDiff = bVal - aVal;
        const featureDiffA = [...a.features].filter((f) => !b.features.has(f));
        const featureDiffB = [...b.features].filter((f) => !a.features.has(f));
        if (featureDiffA.length > 0 || featureDiffB.length > 0 || Math.abs((b.sqft || 0) - (a.sqft || 0)) > 50) {
          const aOnly = featureDiffA.map((f) => PROPERTY_FEATURES.find((pf) => pf.key === f))
            .filter(Boolean).map((pf) => `${pf!.icon} ${pf!.label}`);
          const bOnly = featureDiffB.map((f) => PROPERTY_FEATURES.find((pf) => pf.key === f))
            .filter(Boolean).map((pf) => `${pf!.icon} ${pf!.label}`);
          const aLabel = a.description || `Property ${i + 1}`;
          const bLabel = b.description || `Property ${j + 1}`;
          let detail = "";
          if (aOnly.length > 0) detail += `${aLabel} has: ${aOnly.join(", ")}. `;
          if (bOnly.length > 0) detail += `${bLabel} has: ${bOnly.join(", ")}. `;
          const sqftDiff = (b.sqft || 0) - (a.sqft || 0);
          if (Math.abs(sqftDiff) > 50) detail += `Size diff: ${sqftDiff > 0 ? "+" : ""}${sqftDiff} sqft. `;
          diffs.push({
            label: `${aLabel} vs ${bLabel}`,
            diff: priceDiff,
            detail,
          });
        }
      }
    }
    return diffs;
  }, [userComps]);

  const segments = useMemo(() => {
    const map = new Map<string, { key: string; label: string; tasks: string[]; totalHours: number }>();
    for (const item of scopeItems) {
      const key = item.segment.toLowerCase().replace(/\s+/g, "_");
      const existing = map.get(key);
      if (existing) {
        existing.tasks.push(item.task);
        existing.totalHours += item.laborHours ?? 0;
      } else {
        map.set(key, {
          key,
          label: item.segment,
          tasks: [item.task],
          totalHours: item.laborHours ?? 0,
        });
      }
    }
    return Array.from(map.values());
  }, [scopeItems]);

  function handleClarifyOpen() {
    const defaults: Record<string, string> = {};
    for (const seg of segments) {
      defaults[seg.key] = clarifications[seg.key] ?? "";
    }
    setClarifications(defaults);
    setShowClarify(true);
  }

  async function runSearch() {
    setShowClarify(false);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/real-estate/comparables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          clarifications: Object.fromEntries(
            Object.entries(clarifications).filter(([, v]) => v.trim())
          ),
          userComparables: userComps
            .filter((c) => c.purchasePrice > 0 || c.salePrice > 0)
            .map((c) => ({
              description: c.description || "Unnamed property",
              price: c.salePrice > 0 ? c.salePrice : c.purchasePrice,
              purchasePrice: c.purchasePrice || undefined,
              purchaseDate: c.purchaseDate || undefined,
              salePrice: c.salePrice || undefined,
              saleDate: c.saleDate || undefined,
              sqft: c.sqft || undefined,
              features: [...c.features].map((f) => {
                const pf = PROPERTY_FEATURES.find((p) => p.key === f);
                return pf ? pf.label : f;
              }).join(", "),
              renoWork: c.renoWork || undefined,
              notes: c.notes || undefined,
            })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Search failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function searchDirect() {
    if (scopeItems.length > 0) {
      handleClarifyOpen();
    } else {
      await runSearch();
    }
  }

  return (
    <>
      <Card className="relative border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 via-transparent to-cyan-50/50 pointer-events-none" />
        <CardHeader className="relative">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-emerald-100 p-2.5">
              <TrendingUp className="size-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-slate-900 text-lg">Real Estate Impact</CardTitle>
              <CardDescription className="text-slate-600 mt-0.5">
                AI-powered comparables & estimated value add from your renovation
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 relative">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <Home className="size-3.5" />
              {address}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-600">{province}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-600">{sqft} sqft</span>
            {neighborhoodTier && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-slate-500 capitalize">{neighborhoodTier.replace("_", " ")}</span>
              </>
            )}
          </div>

          {/* Your properties / comparables wizard */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowUserComps(!showUserComps)}
                className="text-sm font-medium text-slate-700 hover:text-slate-900 flex items-center gap-2"
              >
                🏘️ Your properties & comparables
                {userComps.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{userComps.length}</Badge>
                )}
              </button>
              <Button variant="outline" size="sm" onClick={addUserComp} className="h-7 text-xs gap-1.5">
                <Plus className="size-3" />
                Add property
              </Button>
            </div>

            {showUserComps && userComps.length === 0 && (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-5 text-center space-y-3">
                <p className="text-3xl">🏠 ↔️ 🏡</p>
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Add properties you&apos;ve bought, sold, or know about
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Compare a house with a garage to one without, renovated vs original — the AI uses the price differences to calculate what your renovation is actually worth in your market.
                  </p>
                </div>
                <Button onClick={addUserComp} className="gap-1.5">
                  <Plus className="size-3.5" />
                  Add your first property
                </Button>
              </div>
            )}

            {showUserComps && userComps.map((comp, idx) => {
              const isExpanded = expandedComp === comp.id;
              return (
                <div
                  key={comp.id}
                  className={`rounded-xl border transition-all ${
                    isExpanded
                      ? "border-blue-300 bg-white shadow-md"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  {/* Collapsed header */}
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer"
                    onClick={() => setExpandedComp(isExpanded ? null : comp.id)}
                  >
                    <span className="text-xl shrink-0">{idx === 0 ? "🏠" : idx === 1 ? "🏡" : "🏘️"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {comp.description || `Property ${idx + 1}`}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {comp.purchasePrice > 0 && (
                          <span className="tabular-nums">
                            <span className="text-slate-400">Bought</span> <span className="font-semibold text-slate-700">{formatCurrency(comp.purchasePrice)}</span>
                            {comp.purchaseDate && <span className="text-slate-400"> {comp.purchaseDate}</span>}
                          </span>
                        )}
                        {comp.salePrice > 0 && (
                          <span className="tabular-nums">
                            <span className="text-slate-400">→ Sold</span> <span className="font-semibold text-emerald-600">{formatCurrency(comp.salePrice)}</span>
                            {comp.saleDate && <span className="text-slate-400"> {comp.saleDate}</span>}
                          </span>
                        )}
                        {comp.sqft > 0 && <span>· {comp.sqft} sqft</span>}
                        {comp.features.size > 0 && (
                          <span className="flex gap-0.5">
                            {[...comp.features].slice(0, 4).map((f) => {
                              const pf = PROPERTY_FEATURES.find((p) => p.key === f);
                              return pf ? <span key={f} title={pf.label}>{pf.icon}</span> : null;
                            })}
                            {comp.features.size > 4 && <span className="text-slate-400">+{comp.features.size - 4}</span>}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeUserComp(comp.id); }}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 shrink-0"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {/* Expanded form */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 p-4 space-y-4">
                      {/* Description */}
                      <div>
                        <Label className="text-xs text-slate-500 mb-1 block">Property description</Label>
                        <Input
                          value={comp.description}
                          onChange={(e) => updateUserComp(comp.id, { description: e.target.value })}
                          placeholder='e.g. "2-bed bungalow on Oak St"'
                          className="text-sm"
                        />
                      </div>

                      {/* Purchase + Sale in two columns */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
                          <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">🏷️ Purchase</p>
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">Price paid</Label>
                            <div className="relative">
                              <DollarSign className="absolute left-2.5 top-2 size-3.5 text-slate-400" />
                              <Input
                                type="number"
                                value={comp.purchasePrice || ""}
                                onChange={(e) => updateUserComp(comp.id, { purchasePrice: parseFloat(e.target.value) || 0 })}
                                placeholder="0"
                                className="pl-8 tabular-nums text-sm h-8"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-[11px] text-slate-400 mb-0.5 block">Date</Label>
                            <Input
                              value={comp.purchaseDate}
                              onChange={(e) => updateUserComp(comp.id, { purchaseDate: e.target.value })}
                              placeholder="e.g. Mar 2023"
                              className="text-sm h-8"
                            />
                          </div>
                        </div>

                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-2">
                          <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">💰 Sale <span className="text-[10px] font-normal text-emerald-500">(if sold)</span></p>
                          <div>
                            <Label className="text-[11px] text-emerald-600/70 mb-0.5 block">Sale price</Label>
                            <div className="relative">
                              <DollarSign className="absolute left-2.5 top-2 size-3.5 text-emerald-400" />
                              <Input
                                type="number"
                                value={comp.salePrice || ""}
                                onChange={(e) => updateUserComp(comp.id, { salePrice: parseFloat(e.target.value) || 0 })}
                                placeholder="0"
                                className="pl-8 tabular-nums text-sm h-8 border-emerald-200"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-[11px] text-emerald-600/70 mb-0.5 block">Date</Label>
                            <Input
                              value={comp.saleDate}
                              onChange={(e) => updateUserComp(comp.id, { saleDate: e.target.value })}
                              placeholder="e.g. Jun 2024"
                              className="text-sm h-8 border-emerald-200"
                            />
                          </div>
                          {comp.purchasePrice > 0 && comp.salePrice > 0 && (
                            <p className={`text-xs font-semibold tabular-nums ${comp.salePrice >= comp.purchasePrice ? "text-emerald-600" : "text-red-600"}`}>
                              {comp.salePrice >= comp.purchasePrice ? "📈" : "📉"}{" "}
                              {comp.salePrice >= comp.purchasePrice ? "+" : ""}{formatCurrency(comp.salePrice - comp.purchasePrice)} equity
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-slate-500 mb-1 block">📐 Square footage</Label>
                        <Input
                          type="number"
                          value={comp.sqft || ""}
                          onChange={(e) => updateUserComp(comp.id, { sqft: parseInt(e.target.value) || 0 })}
                          placeholder="e.g. 1100"
                          className="text-sm w-32 tabular-nums"
                        />
                      </div>

                      {/* Feature toggles */}
                      <div>
                        <Label className="text-xs text-slate-500 mb-2 block">
                          ✨ Property features — toggle what this property has
                        </Label>
                        <div className="flex flex-wrap gap-1.5">
                          {PROPERTY_FEATURES.map((pf) => {
                            const active = comp.features.has(pf.key);
                            return (
                              <button
                                key={pf.key}
                                onClick={() => toggleFeature(comp.id, pf.key)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                  active
                                    ? "bg-blue-50 text-blue-700 border-blue-300 shadow-sm"
                                    : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                                }`}
                              >
                                <span>{pf.icon}</span>
                                {pf.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Reno work done */}
                      <div>
                        <Label className="text-xs text-slate-500 mb-1 block">
                          🔨 Renovation work done (if any)
                        </Label>
                        <Textarea
                          value={comp.renoWork}
                          onChange={(e) => updateUserComp(comp.id, { renoWork: e.target.value })}
                          rows={2}
                          className="text-sm resize-none"
                          placeholder='e.g. "New kitchen cabinets, LVP flooring throughout, painted"'
                        />
                      </div>

                      {/* Extra notes */}
                      <div>
                        <Label className="text-xs text-slate-500 mb-1 block">📝 Notes</Label>
                        <Input
                          value={comp.notes}
                          onChange={(e) => updateUserComp(comp.id, { notes: e.target.value })}
                          placeholder='e.g. "Sold fast, multiple offers" or "Sat on market 60 days"'
                          className="text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Auto-calculated differences */}
            {showUserComps && autoAdjustments.length > 0 && (
              <div className="rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                  🧮 Auto-calculated value differences
                </p>
                {autoAdjustments.map((adj, i) => (
                  <div key={i} className="bg-white/80 rounded-lg p-3">
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-700">{adj.label}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{adj.detail}</p>
                      </div>
                      <span className={`text-sm font-bold tabular-nums shrink-0 ${adj.diff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {adj.diff >= 0 ? "+" : ""}{formatCurrency(adj.diff)}
                      </span>
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-blue-600">
                  💡 These differences help the AI calculate what your renovation features are actually worth in your market.
                </p>
              </div>
            )}
          </div>

          <Button
            onClick={searchDirect}
            disabled={loading}
            variant="secondary"
            className="w-full sm:w-auto"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
                Searching{userComps.length > 0 ? " (using your comparables)" : ""}…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Search className="size-4" />
                {userComps.length > 0 ? "Analyze with your comparables" : "Quick comparables & value add"}
              </span>
            )}
          </Button>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {result && (
            <div className="space-y-5 pt-2 border-t border-slate-200">
              <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-cyan-50 border border-emerald-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-emerald-600 mb-1">
                      Estimated value add
                    </p>
                    <p className="text-3xl font-bold text-emerald-600 tabular-nums">
                      {result.estimatedValueAdd != null
                        ? formatCurrency(result.estimatedValueAdd)
                        : "—"}
                    </p>
                    {result.valueAddRange && (
                      <p className="text-xs text-slate-500 mt-1 tabular-nums">
                        Range: {formatCurrency(result.valueAddRange[0])} – {formatCurrency(result.valueAddRange[1])}
                      </p>
                    )}
                  </div>
                  {result.estimatedPercentIncrease != null && (
                    <div className="text-right">
                      <p className="text-xs font-medium uppercase tracking-wider text-cyan-600 mb-1">
                        Value increase
                      </p>
                      <p className="text-3xl font-bold text-cyan-600 tabular-nums">
                        +{result.estimatedPercentIncrease.toFixed(1)}%
                      </p>
                      {result.percentRange && (
                        <p className="text-xs text-slate-500 mt-1 tabular-nums">
                          Range: {result.percentRange[0].toFixed(1)}% – {result.percentRange[1].toFixed(1)}%
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {result.confidence && (
                    <Badge
                      variant="outline"
                      className="border-slate-300 text-slate-600 bg-slate-50"
                    >
                      {result.confidence} confidence
                    </Badge>
                  )}
                  {result.usedWebSearch && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                      <Sparkles className="size-3 mr-1" />
                      Web search
                    </Badge>
                  )}
                </div>
              </div>

              {result.mapPins && result.mapPins.length > 0 && (
                <DynamicComparablesMap pins={result.mapPins} />
              )}

              {result.comparables && result.comparables.length > 0 && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 overflow-hidden">
                  <p className="text-sm font-medium text-slate-700 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                    <MapPinIcon className="size-4" />
                    Nearby comparables
                  </p>
                  <ul className="divide-y divide-slate-200">
                    {result.comparables.map((c, i) => (
                      <li key={i} className={`px-4 py-3 ${c.weight === "reference" ? "bg-slate-50/50" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 flex items-center gap-2">
                              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold shrink-0 ${c.weight === "reference" ? "bg-slate-400" : "bg-blue-500"}`}>
                                {i + 1}
                              </span>
                              {c.address}
                              {c.weight && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] px-1.5 py-0 ${
                                    c.weight === "local"
                                      ? "border-blue-300 text-blue-600 bg-blue-50"
                                      : "border-amber-300 text-amber-600 bg-amber-50"
                                  }`}
                                >
                                  {c.weight === "local" ? "Local <=50km" : "Ref only"}
                                </Badge>
                              )}
                            </p>
                            <div className="flex items-center gap-2 ml-7 mt-0.5">
                              {c.sqft != null && c.sqft > 0 && (
                                <span className="text-[11px] text-slate-400 tabular-nums">{c.sqft} sqft</span>
                              )}
                              {c.renovated != null && (
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${c.renovated ? "border-emerald-300 text-emerald-600 bg-emerald-50" : "border-slate-200 text-slate-500"}`}>
                                  {c.renovated ? "Renovated" : "Unrenovated"}
                                </Badge>
                              )}
                            </div>
                            {c.weightReason && (
                              <p className="text-[11px] text-amber-600 mt-0.5 ml-7">{c.weightReason}</p>
                            )}
                            {c.notes && (
                              <p className="text-xs text-slate-500 mt-0.5 ml-7">{c.notes}</p>
                            )}
                          </div>
                          {c.price > 0 && (
                            <span className={`text-sm font-semibold tabular-nums shrink-0 ${c.weight === "reference" ? "text-slate-400" : "text-slate-700"}`}>
                              {formatCurrency(c.price)}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.comparablesSummary && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
                  <p className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                    <BarChart3 className="size-4" />
                    Analysis
                  </p>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {result.comparablesSummary}
                  </p>
                </div>
              )}

              {result.breakdown && result.breakdown.length > 0 && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 overflow-hidden">
                  <p className="text-sm font-medium text-slate-700 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                    <TrendingUp className="size-4" />
                    Value add breakdown
                  </p>
                  <ul className="divide-y divide-slate-200">
                    {result.breakdown.map((b, i) => (
                      <li
                        key={i}
                        className="px-4 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex justify-between items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900">{b.renovation}</p>
                            {b.notes && (
                              <p className="text-xs text-slate-500 mt-0.5">{b.notes}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-emerald-600 font-semibold tabular-nums">
                              +{formatCurrency(b.estimatedAdd)}
                            </span>
                            {b.roi != null && (
                              <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">{b.roi}% ROI</p>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Value adjustments from comparable pairs */}
              {result.adjustments && result.adjustments.length > 0 && (
                <div className="rounded-lg bg-blue-50/50 border border-blue-200 overflow-hidden">
                  <p className="text-sm font-medium text-blue-800 px-4 py-3 border-b border-blue-200 flex items-center gap-2">
                    <ArrowLeftRight className="size-4" />
                    Value adjustments (from comparable pairs)
                  </p>
                  <ul className="divide-y divide-blue-100">
                    {result.adjustments.map((adj, i) => (
                      <li key={i} className="px-4 py-3">
                        <div className="flex justify-between items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800">{adj.factor}</p>
                            {adj.notes && (
                              <p className="text-xs text-slate-500 mt-0.5">{adj.notes}</p>
                            )}
                          </div>
                          <span className={`font-semibold tabular-nums shrink-0 ${adj.valueDifference >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {adj.valueDifference >= 0 ? "+" : ""}{formatCurrency(adj.valueDifference)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.caveats && (
                <p className="text-xs text-slate-500 leading-relaxed">{result.caveats}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClarifyOpen}
                  className="text-slate-500"
                >
                  <MessageSquare className="size-3.5 mr-1.5" />
                  Refine with clarifications
                </Button>
                {userComps.length === 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addUserComp}
                    className="text-slate-500"
                  >
                    <Plus className="size-3.5 mr-1.5" />
                    Add your own comparables
                  </Button>
                )}
              </div>
            </div>
          )}

          {scopeItems.length === 0 && !result && (
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <ExternalLink className="size-4" />
              Add scope items for a more accurate value-add breakdown.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={showClarify} onOpenChange={setShowClarify}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quick clarifications</DialogTitle>
            <DialogDescription>
              Help the AI understand the real scope of each area. A single wall isn't a full basement reno — tell it what's actually happening.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[400px] overflow-y-auto py-2">
            {segments.map((seg) => (
              <div key={seg.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-800">{seg.label}</label>
                  <span className="text-xs text-slate-400">{seg.tasks.length} task{seg.tasks.length !== 1 ? "s" : ""} · {seg.totalHours.toFixed(0)}h</span>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {seg.tasks.slice(0, 3).join(", ")}{seg.tasks.length > 3 ? ` +${seg.tasks.length - 3} more` : ""}
                </p>
                <Textarea
                  value={clarifications[seg.key] ?? ""}
                  onChange={(e) => setClarifications((prev) => ({ ...prev, [seg.key]: e.target.value }))}
                  rows={2}
                  className="text-sm"
                  placeholder={`e.g. "Just one 12ft wall, not a full ${seg.label.toLowerCase()} reno"`}
                />
              </div>
            ))}
            {segments.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">No scope areas detected. The AI will use general project info.</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => { setShowClarify(false); runSearch(); }}>
              Skip — run as-is
            </Button>
            <Button onClick={runSearch}>
              <Search className="size-4 mr-1.5" />
              Search with clarifications
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
