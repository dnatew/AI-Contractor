"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  Hammer,
  Package,
  Plus,
  Trash2,
} from "lucide-react";
import type { UserPricing } from "@prisma/client";

const LABOR_RATE_KEYS = [
  { key: "flooring_sqft", label: "Flooring", unit: "sqft", icon: "floor" },
  { key: "walls_sqft", label: "Walls / Paint", unit: "sqft", icon: "wall" },
  { key: "tiling_sqft", label: "Tiling", unit: "sqft", icon: "tile" },
  { key: "drywall_taping_sqft", label: "Drywall taping", unit: "sqft", icon: "drywall" },
  { key: "baseboard_linear", label: "Baseboard / Trim", unit: "linear ft", icon: "trim" },
];

const COMMON_MATERIALS = [
  "luxury vinyl plank", "vinyl plank", "laminate", "engineered hardwood",
  "hardwood", "ceramic tile", "porcelain tile", "marble tile",
  "underlayment", "baseboard", "transition strips", "subfloor",
  "paint", "primer", "drywall sheet", "drywall compound",
];

type PricingSettingsProps = {
  initialPricing: UserPricing[];
};

export function PricingSettings({ initialPricing }: PricingSettingsProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [laborRates, setLaborRates] = useState<Record<string, string>>({});
  const [materialCosts, setMaterialCosts] = useState<Record<string, { cost: string; unit: string }>>({});
  const [newMatName, setNewMatName] = useState("");
  const [newMatCost, setNewMatCost] = useState("");
  const [newMatUnit, setNewMatUnit] = useState("sqft");

  useEffect(() => {
    const lr: Record<string, string> = {};
    const mc: Record<string, { cost: string; unit: string }> = {};
    for (const p of initialPricing) {
      if (p.key.startsWith("mat:")) {
        mc[p.key.slice(4)] = { cost: String(p.rate), unit: p.unit };
      } else {
        lr[p.key] = String(p.rate);
      }
    }
    setLaborRates(lr);
    setMaterialCosts(mc);
  }, [initialPricing]);

  async function saveRate(key: string, rate: string, unit: string) {
    const num = parseFloat(rate);
    if (isNaN(num) || num < 0) return;
    setSaving(true);
    try {
      await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, rate: num, unit }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function removeRate(key: string) {
    setSaving(true);
    try {
      await fetch(`/api/pricing/${encodeURIComponent(key)}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function saveMaterial(name: string, cost: string, unit: string) {
    saveRate(`mat:${name.toLowerCase()}`, cost, unit);
  }

  function removeMaterial(name: string) {
    removeRate(`mat:${name.toLowerCase()}`);
    setMaterialCosts((prev) => {
      const next = { ...prev };
      delete next[name.toLowerCase()];
      return next;
    });
  }

  function addNewMaterial() {
    const name = newMatName.trim().toLowerCase();
    if (!name || !newMatCost) return;
    setMaterialCosts((prev) => ({ ...prev, [name]: { cost: newMatCost, unit: newMatUnit } }));
    saveMaterial(name, newMatCost, newMatUnit);
    setNewMatName("");
    setNewMatCost("");
  }

  return (
    <div className="space-y-6">
      {/* Labor rates */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Hammer className="size-5 text-slate-400" />
            <div>
              <CardTitle className="text-slate-900">Labor Rates</CardTitle>
              <CardDescription className="text-slate-600">
                Your all-in rate per unit for common tasks. Includes labor + materials combined.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {LABOR_RATE_KEYS.map(({ key, label, unit }) => (
              <div key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{label}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <DollarSign className="size-3.5 text-slate-400" />
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="—"
                      value={laborRates[key] ?? ""}
                      onChange={(e) => setLaborRates((prev) => ({ ...prev, [key]: e.target.value }))}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v) saveRate(key, v, unit);
                      }}
                      className="bg-white border-slate-300 h-8 text-sm w-24"
                    />
                    <span className="text-xs text-slate-500">/ {unit}</span>
                  </div>
                </div>
                {laborRates[key] && (
                  <button
                    onClick={() => { removeRate(key); setLaborRates((prev) => { const n = { ...prev }; delete n[key]; return n; }); }}
                    disabled={saving}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            When set, these rates override default province pricing for matching scope items.
          </p>
        </CardContent>
      </Card>

      {/* Material costs */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="size-5 text-slate-400" />
            <div>
              <CardTitle className="text-slate-900">Material Costs</CardTitle>
              <CardDescription className="text-slate-600">
                Set your actual material costs from your supplier. These are used for the material column in estimates.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing materials */}
          {Object.keys(materialCosts).length > 0 && (
            <div className="space-y-2">
              {Object.entries(materialCosts).map(([name, { cost, unit }]) => (
                <div key={name} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <Badge variant="outline" className="text-xs capitalize shrink-0">{name}</Badge>
                  <div className="flex items-center gap-2 flex-1">
                    <DollarSign className="size-3.5 text-slate-400" />
                    <Input
                      type="number"
                      step="0.25"
                      min="0"
                      value={cost}
                      onChange={(e) => setMaterialCosts((prev) => ({ ...prev, [name]: { cost: e.target.value, unit } }))}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v) saveMaterial(name, v, unit);
                      }}
                      className="bg-white border-slate-300 h-8 text-sm w-24"
                    />
                    <select
                      value={unit}
                      onChange={(e) => {
                        const newUnit = e.target.value;
                        setMaterialCosts((prev) => ({ ...prev, [name]: { cost, unit: newUnit } }));
                        if (cost) saveMaterial(name, cost, newUnit);
                      }}
                      className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                    >
                      <option value="sqft">/ sqft</option>
                      <option value="linear ft">/ linear ft</option>
                      <option value="each">/ each</option>
                      <option value="sheet">/ sheet</option>
                      <option value="gallon">/ gallon</option>
                      <option value="bag">/ bag</option>
                    </select>
                  </div>
                  <button
                    onClick={() => removeMaterial(name)}
                    disabled={saving}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new material */}
          <div className="rounded-lg border-2 border-dashed border-slate-200 p-3 space-y-3">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Add material</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[160px]">
                <Input
                  value={newMatName}
                  onChange={(e) => setNewMatName(e.target.value)}
                  placeholder="Material name..."
                  className="bg-white border-slate-300 h-8 text-sm"
                  list="common-materials"
                />
                <datalist id="common-materials">
                  {COMMON_MATERIALS.filter((m) => !materialCosts[m]).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div className="flex items-center gap-1">
                <DollarSign className="size-3.5 text-slate-400" />
                <Input
                  type="number"
                  step="0.25"
                  min="0"
                  value={newMatCost}
                  onChange={(e) => setNewMatCost(e.target.value)}
                  placeholder="0.00"
                  className="bg-white border-slate-300 h-8 text-sm w-20"
                />
              </div>
              <select
                value={newMatUnit}
                onChange={(e) => setNewMatUnit(e.target.value)}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
              >
                <option value="sqft">/ sqft</option>
                <option value="linear ft">/ linear ft</option>
                <option value="each">/ each</option>
                <option value="sheet">/ sheet</option>
                <option value="gallon">/ gallon</option>
                <option value="bag">/ bag</option>
              </select>
              <Button size="sm" className="h-8 gap-1" onClick={addNewMaterial} disabled={!newMatName.trim() || !newMatCost}>
                <Plus className="size-3" />
                Add
              </Button>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Material costs are matched by name against scope items. Use names that match what the AI generates (e.g. "luxury vinyl plank", "ceramic tile").
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
