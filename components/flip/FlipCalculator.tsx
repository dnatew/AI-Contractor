"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useUserProperties } from "@/hooks/useUserProperties";
import {
  DollarSign,
  Sparkles,
  TrendingUp,
  Home,
  Hammer,
  Clock,
  Percent,
  Calculator,
  ArrowRight,
  Building,
  Scale,
  AlertTriangle,
  HelpCircle,
  MapPin,
  ChevronDown,
  ChevronUp,
  Bookmark,
  History,
  Save,
  Trash2,
} from "lucide-react";

type FlipCalculatorProps = {
  projectId: string;
  address: string;
  province: string;
  sqft: string;
  renovationCost: number;
  estimatedValueAdd?: number;
  estimatedPercentIncrease?: number;
};

type SavedFlipSearch = {
  id: string;
  title: string | null;
  purchasePrice: number;
  salePrice: number;
  renoCost: number;
  holdingMonths: number;
  monthlyMortgage: number;
  monthlyTaxes: number;
  monthlyInsurance: number;
  monthlyUtilities: number;
  realtorPct: number;
  legalFees: number;
  staging: number;
  userNotes: string | null;
  aiReasoning: string | null;
  comparablesFound: string | null;
  marketType: string | null;
  roiPatternJson: {
    dealCount: number;
    avgPctGain: number;
    avgROI: number | null;
    avgEquity: number;
  } | null;
  createdAt: string;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function FlipCalculator({
  projectId,
  address,
  province,
  sqft,
  renovationCost,
  estimatedValueAdd,
  estimatedPercentIncrease,
}: FlipCalculatorProps) {
  const { properties: savedProperties } = useUserProperties();
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [salePrice, setSalePrice] = useState<number>(0);
  const [renoCost, setRenoCost] = useState<number>(renovationCost);
  const [holdingMonths, setHoldingMonths] = useState<number>(4);
  const [monthlyMortgage, setMonthlyMortgage] = useState<number>(1500);
  const [monthlyTaxes, setMonthlyTaxes] = useState<number>(250);
  const [monthlyInsurance, setMonthlyInsurance] = useState<number>(150);
  const [monthlyUtilities, setMonthlyUtilities] = useState<number>(200);
  const [realtorPct, setRealtorPct] = useState<number>(5);
  const [legalFees, setLegalFees] = useState<number>(2500);
  const [staging, setStaging] = useState<number>(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const [roiPattern, setRoiPattern] = useState<{
    dealCount: number;
    avgPctGain: number;
    avgROI: number | null;
    avgEquity: number;
  } | null>(null);
  const [comparablesFound, setComparablesFound] = useState<string | null>(null);
  const [marketType, setMarketType] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedFlipSearch[]>([]);
  const [loadingSearches, setLoadingSearches] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);

  // User context for AI
  const [showContext, setShowContext] = useState(true);
  const [userNotes, setUserNotes] = useState("");
  const [contextSubmitted, setContextSubmitted] = useState(false);

  const localPattern = useMemo(() => {
    const deals = savedProperties.filter((p) => p.purchasePrice > 0 && p.salePrice > 0);
    if (deals.length === 0) return null;
    const gains = deals.map((d) => ((d.salePrice - d.purchasePrice) / d.purchasePrice) * 100);
    const equities = deals.map((d) => d.salePrice - d.purchasePrice);
    const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
    const avgEquity = equities.reduce((a, b) => a + b, 0) / equities.length;
    return { dealCount: deals.length, avgGain: Math.round(avgGain * 10) / 10, avgEquity: Math.round(avgEquity) };
  }, [savedProperties]);

  const monthlyHolding = monthlyMortgage + monthlyTaxes + monthlyInsurance + monthlyUtilities;
  const totalHolding = monthlyHolding * holdingMonths;
  const realtorFees = salePrice * (realtorPct / 100);
  const totalSellingCosts = realtorFees + legalFees + staging;
  const totalInvestment = purchasePrice + renoCost + totalHolding + totalSellingCosts;
  const profit = salePrice - totalInvestment;
  const roi = totalInvestment > 0 ? (profit / totalInvestment) * 100 : 0;
  const cashOnCash = (purchasePrice + renoCost) > 0 ? (profit / (purchasePrice + renoCost)) * 100 : 0;

  const profitColor = profit > 0 ? "text-emerald-600" : profit < 0 ? "text-red-600" : "text-slate-600";
  const profitBg = profit > 0 ? "from-emerald-50 to-cyan-50 border-emerald-200" : profit < 0 ? "from-red-50 to-orange-50 border-red-200" : "from-slate-50 to-slate-50 border-slate-200";

  const maxOffer = useMemo(() => {
    if (salePrice <= 0) return 0;
    return salePrice - renoCost - totalHolding - totalSellingCosts - (salePrice * 0.1);
  }, [salePrice, renoCost, totalHolding, totalSellingCosts]);

  const loadSavedSearches = useCallback(async () => {
    setLoadingSearches(true);
    try {
      const res = await fetch(`/api/flip-searches?projectId=${projectId}`);
      if (!res.ok) return;
      const data = (await res.json()) as SavedFlipSearch[];
      setSavedSearches(data);
    } finally {
      setLoadingSearches(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadSavedSearches();
  }, [loadSavedSearches]);

  async function saveCurrentSearch(
    customTitle?: string,
    snapshot?: Partial<{
      purchasePrice: number;
      salePrice: number;
      holdingMonths: number;
      monthlyMortgage: number;
      monthlyTaxes: number;
      monthlyInsurance: number;
      monthlyUtilities: number;
      aiReasoning: string | null;
      comparablesFound: string | null;
      marketType: string | null;
      roiPattern: {
        dealCount: number;
        avgPctGain: number;
        avgROI: number | null;
        avgEquity: number;
      } | null;
    }>
  ) {
    setSavingSearch(true);
    try {
      const title = customTitle ?? `Flip snapshot ${new Date().toLocaleDateString("en-CA")}`;
      const res = await fetch("/api/flip-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title,
          purchasePrice: snapshot?.purchasePrice ?? purchasePrice,
          salePrice: snapshot?.salePrice ?? salePrice,
          renoCost,
          holdingMonths: snapshot?.holdingMonths ?? holdingMonths,
          monthlyMortgage: snapshot?.monthlyMortgage ?? monthlyMortgage,
          monthlyTaxes: snapshot?.monthlyTaxes ?? monthlyTaxes,
          monthlyInsurance: snapshot?.monthlyInsurance ?? monthlyInsurance,
          monthlyUtilities: snapshot?.monthlyUtilities ?? monthlyUtilities,
          realtorPct,
          legalFees,
          staging,
          userNotes: userNotes.trim() || null,
          aiReasoning: snapshot?.aiReasoning ?? aiReasoning,
          comparablesFound: snapshot?.comparablesFound ?? comparablesFound,
          marketType: snapshot?.marketType ?? marketType,
          roiPatternJson: snapshot?.roiPattern ?? roiPattern,
        }),
      });
      if (res.ok) {
        await loadSavedSearches();
      }
    } finally {
      setSavingSearch(false);
    }
  }

  async function deleteSearch(id: string) {
    const res = await fetch(`/api/flip-searches?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    }
  }

  async function clearAllSearches() {
    const res = await fetch(`/api/flip-searches?projectId=${projectId}&all=1`, { method: "DELETE" });
    if (res.ok) {
      setSavedSearches([]);
    }
  }

  function applySavedSearch(s: SavedFlipSearch) {
    setPurchasePrice(s.purchasePrice);
    setSalePrice(s.salePrice);
    setRenoCost(s.renoCost);
    setHoldingMonths(s.holdingMonths);
    setMonthlyMortgage(s.monthlyMortgage);
    setMonthlyTaxes(s.monthlyTaxes);
    setMonthlyInsurance(s.monthlyInsurance);
    setMonthlyUtilities(s.monthlyUtilities);
    setRealtorPct(s.realtorPct);
    setLegalFees(s.legalFees);
    setStaging(s.staging);
    setUserNotes(s.userNotes ?? "");
    setAiReasoning(s.aiReasoning);
    setComparablesFound(s.comparablesFound);
    setMarketType(s.marketType);
    setRoiPattern(s.roiPatternJson);
  }

  async function generateAI() {
    setAiLoading(true);
    setAiReasoning(null);
    try {
      const res = await fetch("/api/ai/flip-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          userContext: {
            userNotes: userNotes.trim() || undefined,
            currentPurchasePrice: purchasePrice > 0 ? purchasePrice : undefined,
            currentSalePrice: salePrice > 0 ? salePrice : undefined,
          },
          userProperties: savedProperties
            .filter((p) => p.purchasePrice > 0 || p.salePrice > 0)
            .map((p) => ({
              description: p.description || "Unnamed property",
              purchasePrice: p.purchasePrice || undefined,
              purchaseDate: p.purchaseDate || undefined,
              salePrice: p.salePrice || undefined,
              saleDate: p.saleDate || undefined,
              sqft: p.sqft || undefined,
              features: [...p.features].join(", ") || undefined,
              renoWork: p.renoWork || undefined,
            })),
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const nextPurchasePrice =
        !purchasePrice && data.suggestedPurchaseRange
          ? Math.round((data.suggestedPurchaseRange[0] + data.suggestedPurchaseRange[1]) / 2)
          : purchasePrice;
      const nextSalePrice =
        !salePrice && data.suggestedARVRange
          ? Math.round((data.suggestedARVRange[0] + data.suggestedARVRange[1]) / 2)
          : salePrice;
      const nextHoldingMonths =
        data.suggestedHoldingMonths && holdingMonths === 4
          ? data.suggestedHoldingMonths
          : holdingMonths;
      let nextMonthlyMortgage = monthlyMortgage;
      let nextMonthlyTaxes = monthlyTaxes;
      let nextMonthlyInsurance = monthlyInsurance;
      let nextMonthlyUtilities = monthlyUtilities;
      if (data.monthlyHoldingCost) {
        const monthly = Math.round(data.monthlyHoldingCost);
        nextMonthlyMortgage = Math.round(monthly * 0.55);
        nextMonthlyTaxes = Math.round(monthly * 0.2);
        nextMonthlyInsurance = Math.round(monthly * 0.1);
        nextMonthlyUtilities = Math.round(monthly * 0.15);
      }
      const reasoningCombined = data.caution
        ? data.reasoning
          ? `${data.reasoning}\n\n⚠️ ${data.caution}`
          : `⚠️ ${data.caution}`
        : data.reasoning ?? null;

      if (data.suggestedPurchaseRange) {
        if (!purchasePrice || purchasePrice === 0) {
          setPurchasePrice(nextPurchasePrice);
        }
      }
      if (data.suggestedARVRange) {
        if (!salePrice || salePrice === 0) {
          setSalePrice(nextSalePrice);
        }
      }
      if (data.suggestedHoldingMonths && holdingMonths === 4) {
        setHoldingMonths(nextHoldingMonths);
      }
      if (data.monthlyHoldingCost) {
        setMonthlyMortgage(nextMonthlyMortgage);
        setMonthlyTaxes(nextMonthlyTaxes);
        setMonthlyInsurance(nextMonthlyInsurance);
        setMonthlyUtilities(nextMonthlyUtilities);
      }
      if (reasoningCombined) setAiReasoning(reasoningCombined);
      if (data.comparablesFound) setComparablesFound(data.comparablesFound);
      if (data.marketType) setMarketType(data.marketType);
      if (data.roiPattern) setRoiPattern(data.roiPattern);
      setAiApplied(true);
      setContextSubmitted(true);
      setShowContext(false);
      await saveCurrentSearch("AI suggested ranges", {
        purchasePrice: nextPurchasePrice,
        salePrice: nextSalePrice,
        holdingMonths: nextHoldingMonths,
        monthlyMortgage: nextMonthlyMortgage,
        monthlyTaxes: nextMonthlyTaxes,
        monthlyInsurance: nextMonthlyInsurance,
        monthlyUtilities: nextMonthlyUtilities,
        aiReasoning: reasoningCombined,
        comparablesFound: data.comparablesFound ?? comparablesFound,
        marketType: data.marketType ?? marketType,
        roiPattern: data.roiPattern ?? roiPattern,
      });
    } catch {
      // silent
    } finally {
      setAiLoading(false);
    }
  }

  function applyValueAdd() {
    if (!estimatedValueAdd || purchasePrice <= 0) return;
    setSalePrice(purchasePrice + estimatedValueAdd);
  }

  return (
    <div className="space-y-4">
      {/* Header + local context */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="py-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Calculator className="size-4" />
                Flip Calculator
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {address} · {sqft} sqft · {province}
              </p>
            </div>
            <div className="flex gap-2">
              {estimatedValueAdd != null && estimatedValueAdd > 0 && purchasePrice > 0 && (
                <Button variant="outline" size="sm" onClick={applyValueAdd} className="gap-1.5 text-xs">
                  <TrendingUp className="size-3" />
                  Apply value add ({fmt(estimatedValueAdd)})
                </Button>
              )}
              {contextSubmitted && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowContext(!showContext)}
                  className="gap-1 text-xs text-slate-500"
                >
                  <HelpCircle className="size-3" />
                  {showContext ? "Hide" : "Edit"} context
                  {showContext ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </Button>
              )}
            </div>
          </div>

          {/* Local market context questions */}
          {showContext && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-slate-400" />
                  Optional local context
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  AI already prioritizes your saved properties and local comparables. Add notes only if there is special context to include.
                </p>
              </div>

              <div>
                <Label className="text-xs text-slate-600 mb-1.5 block">
                  Extra notes for AI (optional)
                </Label>
                <Textarea
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  rows={2}
                  className="bg-white text-sm resize-none"
                  placeholder='e.g. "This street has mostly duplexes, not detached homes. Avoid lakefront comps."'
                />
              </div>

              <Button
                onClick={generateAI}
                disabled={aiLoading}
                className="w-full gap-1.5"
              >
                {aiLoading ? (
                  <>
                    <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Getting AI suggestions...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    {aiApplied ? "Re-run with updated context" : "Get AI-suggested ranges"}
                  </>
                )}
              </Button>
              <p className="text-[11px] text-slate-400 text-center">
                AI suggests ranges from local-first comparables + your property history. You control final numbers.
              </p>
            </div>
          )}

          {/* ROI pattern from past deals */}
          {roiPattern && roiPattern.dealCount > 0 && (
            <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-3.5 text-violet-500" />
                <span className="text-xs font-semibold text-violet-800">
                  Your Track Record ({roiPattern.dealCount} deal{roiPattern.dealCount > 1 ? "s" : ""})
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="text-xs text-violet-700">
                  Avg gain: <span className="font-bold tabular-nums">+{roiPattern.avgPctGain}%</span>
                </div>
                {roiPattern.avgROI !== null && (
                  <div className="text-xs text-violet-700">
                    ROI on reno: <span className="font-bold tabular-nums">{roiPattern.avgROI}%</span>
                  </div>
                )}
                <div className="text-xs text-violet-700">
                  Avg equity: <span className="font-bold tabular-nums">{fmt(roiPattern.avgEquity)}</span>
                </div>
              </div>
              <p className="text-[11px] text-violet-600 leading-relaxed">
                AI is using your past performance as the strongest predictor for this deal.
              </p>
            </div>
          )}

          {/* AI reasoning */}
          {aiReasoning && (
            <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 leading-relaxed whitespace-pre-line">
              <Sparkles className="size-3 inline mr-1 text-slate-400" />
              {aiReasoning}
            </div>
          )}

          {/* Market type + comparables found */}
          {(comparablesFound || marketType) && (
            <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 space-y-1">
              {marketType && (
                <div className="flex items-center gap-1.5">
                  <Home className="size-3 text-slate-400" />
                  <span>Market type: <span className="font-medium text-slate-700 capitalize">{marketType.replace(/_/g, " ")}</span></span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-400">local comps weighted highest, out-of-area for reference only</span>
                </div>
              )}
              {comparablesFound && (
                <div>
                  <MapPin className="size-3 inline mr-1 text-slate-400" />
                  {comparablesFound}
                </div>
              )}
            </div>
          )}

          {/* Quick re-run if context is collapsed */}
          {contextSubmitted && !showContext && (
            <div className="flex items-center gap-2">
              <Button
                onClick={generateAI}
                disabled={aiLoading}
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
              >
                <Sparkles className="size-3" />
                Re-run AI suggestions
              </Button>
              {userNotes.trim() && (
                <span className="text-[11px] text-slate-400">
                  Using your custom notes
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Saved Properties — quick reference & auto-fill */}
      {savedProperties.length > 0 && (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5 text-slate-800">
              <Bookmark className="size-4 text-violet-500" />
              Your Properties
              <Badge variant="secondary" className="text-[10px] ml-1">{savedProperties.length}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Click a property to use its prices as a starting point
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {savedProperties.map((prop) => {
                const hasData = prop.purchasePrice > 0 || prop.salePrice > 0;
                const equity = prop.salePrice > 0 && prop.purchasePrice > 0
                  ? prop.salePrice - prop.purchasePrice
                  : null;
                return (
                  <button
                    key={prop.id}
                    disabled={!hasData}
                    onClick={() => {
                      if (prop.purchasePrice > 0) setPurchasePrice(prop.purchasePrice);
                      if (prop.salePrice > 0) setSalePrice(prop.salePrice);
                    }}
                    className={`text-left rounded-lg border p-3 transition-all ${
                      hasData
                        ? "border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 cursor-pointer"
                        : "border-slate-100 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <p className="text-xs font-medium text-slate-800 truncate">
                      {prop.description || "Unnamed property"}
                    </p>
                    {prop.sqft > 0 && (
                      <p className="text-[11px] text-slate-400">{prop.sqft} sqft</p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                      {prop.purchasePrice > 0 && (
                        <span className="text-[11px] text-slate-500">
                          Buy: <span className="font-medium text-slate-700 tabular-nums">{fmt(prop.purchasePrice)}</span>
                          {prop.purchaseDate && <span className="text-slate-400 ml-0.5">({prop.purchaseDate})</span>}
                        </span>
                      )}
                      {prop.salePrice > 0 && (
                        <span className="text-[11px] text-slate-500">
                          Sell: <span className="font-medium text-emerald-600 tabular-nums">{fmt(prop.salePrice)}</span>
                          {prop.saleDate && <span className="text-slate-400 ml-0.5">({prop.saleDate})</span>}
                        </span>
                      )}
                    </div>
                    {equity !== null && (
                      <p className={`text-[11px] font-medium mt-1 ${equity >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {equity >= 0 ? "+" : ""}{fmt(equity)} equity
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-1.5 text-slate-800">
              <History className="size-4 text-slate-500" />
              Saved Flip Searches
              <Badge variant="secondary" className="text-[10px] ml-1">{savedSearches.length}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void saveCurrentSearch()}
                disabled={savingSearch}
                className="text-xs gap-1"
              >
                <Save className="size-3" />
                {savingSearch ? "Saving..." : "Save current"}
              </Button>
              {savedSearches.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void clearAllSearches()}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  Clear all
                </Button>
              )}
            </div>
          </div>
          <CardDescription className="text-xs">
            Reuse previous flip scenarios or erase them anytime.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loadingSearches ? (
            <p className="text-xs text-slate-500">Loading saved searches...</p>
          ) : savedSearches.length === 0 ? (
            <p className="text-xs text-slate-500">No saved searches yet.</p>
          ) : (
            <div className="space-y-2">
              {savedSearches.map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-200 p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">
                      {s.title || "Flip snapshot"}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Buy {fmt(s.purchasePrice)} · Sell {fmt(s.salePrice)} · ROI est from snapshot
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {new Date(s.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => applySavedSearch(s)}>
                      Apply
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-600 hover:text-red-700"
                      onClick={() => void deleteSearch(s.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Purchase */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-1.5 text-slate-800">
              <Home className="size-4 text-blue-500" />
              Purchase
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-slate-500">Purchase Price</Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-2.5 size-3.5 text-slate-400" />
                <Input
                  type="number"
                  value={purchasePrice || ""}
                  onChange={(e) => setPurchasePrice(parseFloat(e.target.value) || 0)}
                  className="pl-8 tabular-nums"
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Renovation Cost</Label>
              <div className="relative mt-1">
                <Hammer className="absolute left-2.5 top-2.5 size-3.5 text-slate-400" />
                <Input
                  type="number"
                  value={renoCost || ""}
                  onChange={(e) => setRenoCost(parseFloat(e.target.value) || 0)}
                  className="pl-8 tabular-nums"
                  placeholder="0"
                />
              </div>
              {renovationCost > 0 && renoCost !== renovationCost && (
                <button
                  onClick={() => setRenoCost(renovationCost)}
                  className="text-[11px] text-blue-600 hover:underline mt-1"
                >
                  Reset to estimate ({fmt(renovationCost)})
                </button>
              )}
            </div>
            <div className="pt-2 border-t border-slate-100">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Total acquisition</span>
                <span className="font-semibold text-slate-800 tabular-nums">{fmt(purchasePrice + renoCost)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Holding Costs */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-1.5 text-slate-800">
              <Clock className="size-4 text-amber-500" />
              Holding Costs
            </CardTitle>
            <CardDescription className="text-xs">Monthly costs × holding period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div>
              <Label className="text-xs text-slate-500">Holding Period (months)</Label>
              <Input
                type="number"
                value={holdingMonths || ""}
                onChange={(e) => setHoldingMonths(parseInt(e.target.value) || 0)}
                className="mt-1 tabular-nums"
                min={1}
                max={36}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] text-slate-400">Mortgage/mo</Label>
                <div className="relative mt-0.5">
                  <DollarSign className="absolute left-2 top-2 size-3 text-slate-300" />
                  <Input
                    type="number"
                    value={monthlyMortgage || ""}
                    onChange={(e) => setMonthlyMortgage(parseFloat(e.target.value) || 0)}
                    className="pl-6 text-xs h-8 tabular-nums"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-slate-400">Taxes/mo</Label>
                <div className="relative mt-0.5">
                  <DollarSign className="absolute left-2 top-2 size-3 text-slate-300" />
                  <Input
                    type="number"
                    value={monthlyTaxes || ""}
                    onChange={(e) => setMonthlyTaxes(parseFloat(e.target.value) || 0)}
                    className="pl-6 text-xs h-8 tabular-nums"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-slate-400">Insurance/mo</Label>
                <div className="relative mt-0.5">
                  <DollarSign className="absolute left-2 top-2 size-3 text-slate-300" />
                  <Input
                    type="number"
                    value={monthlyInsurance || ""}
                    onChange={(e) => setMonthlyInsurance(parseFloat(e.target.value) || 0)}
                    className="pl-6 text-xs h-8 tabular-nums"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-slate-400">Utilities/mo</Label>
                <div className="relative mt-0.5">
                  <DollarSign className="absolute left-2 top-2 size-3 text-slate-300" />
                  <Input
                    type="number"
                    value={monthlyUtilities || ""}
                    onChange={(e) => setMonthlyUtilities(parseFloat(e.target.value) || 0)}
                    className="pl-6 text-xs h-8 tabular-nums"
                  />
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Monthly total</span>
                <span className="tabular-nums text-slate-700">{fmt(monthlyHolding)}/mo</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Total holding ({holdingMonths} mo)</span>
                <span className="font-semibold text-slate-800 tabular-nums">{fmt(totalHolding)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sale */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-1.5 text-slate-800">
              <Building className="size-4 text-emerald-500" />
              Sale
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-slate-500">Sale Price (ARV)</Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-2.5 size-3.5 text-slate-400" />
                <Input
                  type="number"
                  value={salePrice || ""}
                  onChange={(e) => setSalePrice(parseFloat(e.target.value) || 0)}
                  className="pl-8 tabular-nums"
                  placeholder="0"
                />
              </div>
              {estimatedValueAdd != null && purchasePrice > 0 && (
                <p className="text-[11px] text-slate-400 mt-1">
                  Value add suggests {fmt(purchasePrice + estimatedValueAdd)}
                  {estimatedPercentIncrease != null && ` (+${estimatedPercentIncrease.toFixed(1)}%)`}
                </p>
              )}
              {localPattern && purchasePrice > 0 && (
                <button
                  onClick={() => setSalePrice(Math.round(purchasePrice * (1 + localPattern.avgGain / 100)))}
                  className="text-[11px] text-violet-600 hover:underline mt-1 flex items-center gap-1"
                >
                  <TrendingUp className="size-3" />
                  Apply my avg +{localPattern.avgGain}% ({fmt(Math.round(purchasePrice * (1 + localPattern.avgGain / 100)))})
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] text-slate-400">Realtor %</Label>
                <div className="relative mt-0.5">
                  <Percent className="absolute left-2 top-2 size-3 text-slate-300" />
                  <Input
                    type="number"
                    value={realtorPct || ""}
                    onChange={(e) => setRealtorPct(parseFloat(e.target.value) || 0)}
                    className="pl-6 text-xs h-8 tabular-nums"
                    step={0.5}
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-slate-400">Legal fees</Label>
                <div className="relative mt-0.5">
                  <DollarSign className="absolute left-2 top-2 size-3 text-slate-300" />
                  <Input
                    type="number"
                    value={legalFees || ""}
                    onChange={(e) => setLegalFees(parseFloat(e.target.value) || 0)}
                    className="pl-6 text-xs h-8 tabular-nums"
                  />
                </div>
              </div>
            </div>
            <div>
              <Label className="text-[11px] text-slate-400">Staging / other</Label>
              <div className="relative mt-0.5">
                <DollarSign className="absolute left-2 top-2 size-3 text-slate-300" />
                <Input
                  type="number"
                  value={staging || ""}
                  onChange={(e) => setStaging(parseFloat(e.target.value) || 0)}
                  className="pl-6 text-xs h-8 tabular-nums"
                />
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Realtor fees</span>
                <span className="tabular-nums text-slate-700">{fmt(realtorFees)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Total selling costs</span>
                <span className="font-semibold text-slate-800 tabular-nums">{fmt(totalSellingCosts)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results */}
      {(purchasePrice > 0 || salePrice > 0) && (
        <Card className={`border shadow-sm bg-gradient-to-br ${profitBg} overflow-hidden`}>
          <CardContent className="py-5">
            {/* Flow visualization */}
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 mb-5">
              <span className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 font-medium">
                Buy {fmt(purchasePrice)}
              </span>
              <ArrowRight className="size-3.5 text-slate-300" />
              <span className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 font-medium">
                Reno {fmt(renoCost)}
              </span>
              <ArrowRight className="size-3.5 text-slate-300" />
              <span className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 font-medium">
                Hold {fmt(totalHolding)}
              </span>
              <ArrowRight className="size-3.5 text-slate-300" />
              <span className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 font-medium">
                Sell {fmt(salePrice)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {/* Profit */}
              <div className="text-center">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
                  Net Profit
                </p>
                <p className={`text-2xl font-bold tabular-nums ${profitColor}`}>
                  {fmt(profit)}
                </p>
              </div>

              {/* ROI */}
              <div className="text-center">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
                  ROI
                </p>
                <p className={`text-2xl font-bold tabular-nums ${profitColor}`}>
                  {pct(roi)}
                </p>
              </div>

              {/* Cash on cash */}
              <div className="text-center">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
                  Cash-on-Cash
                </p>
                <p className={`text-2xl font-bold tabular-nums ${profitColor}`}>
                  {pct(cashOnCash)}
                </p>
              </div>

              {/* Total investment */}
              <div className="text-center">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
                  Total In
                </p>
                <p className="text-2xl font-bold tabular-nums text-slate-700">
                  {fmt(totalInvestment)}
                </p>
              </div>
            </div>

            {/* Cost breakdown bar */}
            {totalInvestment > 0 && (() => {
              const segments = [
                { label: "Purchase", value: purchasePrice, color: "bg-blue-400" },
                { label: "Renovation", value: renoCost, color: "bg-amber-400" },
                { label: "Holding", value: totalHolding, color: "bg-purple-400" },
                { label: "Selling", value: totalSellingCosts, color: "bg-rose-400" },
              ]
                .filter((s) => s.value > 0)
                .map((s) => ({ ...s, pct: (s.value / totalInvestment) * 100 }));

              return (
                <div className="mt-5">
                  <div className="flex rounded-full overflow-hidden h-4 bg-slate-200">
                    {segments.map((s) => (
                      <div
                        key={s.label}
                        className={`${s.color} transition-all relative group`}
                        style={{ width: `${s.pct}%` }}
                        title={`${s.label}: ${fmt(s.value)} (${s.pct.toFixed(1)}%)`}
                      >
                        {s.pct >= 12 && (
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white/90">
                            {s.pct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-2 gap-x-3 mt-3">
                    {segments.map((s) => (
                      <div key={s.label} className="flex items-center gap-2">
                        <span className={`size-2.5 rounded-full ${s.color} shrink-0`} />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-slate-700 leading-tight">{s.label}</p>
                          <p className="text-[11px] text-slate-500 tabular-nums leading-tight">
                            {fmt(s.value)} · {s.pct.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Max offer rule */}
            {salePrice > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-200/50">
                <div className="flex items-start gap-2">
                  <Scale className="size-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-slate-700">
                      70% Rule Max Offer: <span className="font-bold tabular-nums">{fmt(maxOffer)}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      ARV × 70% minus reno, holding, and selling costs. A common guideline for flip profitability.
                    </p>
                  </div>
                </div>
                {purchasePrice > maxOffer && purchasePrice > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    Purchase price is {fmt(purchasePrice - maxOffer)} above the 70% rule max offer.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
