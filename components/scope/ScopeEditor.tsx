"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Hammer,
  Package,
  Clock,
  Ruler,
  Trash2,
  Plus,
  Sparkles,
  Pen,
  LayoutGrid,
  GripVertical,
} from "lucide-react";
import type { Scope, ScopeItem } from "@prisma/client";

type ScopeEditorProps = {
  projectId: string;
  scopes: (Scope & { items: ScopeItem[] })[];
};

export function ScopeEditor({ projectId, scopes: initialScopes }: ScopeEditorProps) {
  const router = useRouter();
  const [scopes, setScopes] = useState(initialScopes);

  const scopeKey = initialScopes.map(s => `${s.id}:${s.items.length}:${s.items.map(i => i.id).join(",")}`).join("|");
  useEffect(() => {
    setScopes(initialScopes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  function updateLocalItem(scopeId: string, itemId: string, updates: Partial<ScopeItem>) {
    setScopes((prev) =>
      prev.map((s) =>
        s.id === scopeId
          ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)) }
          : s
      )
    );
  }

  async function saveItem(id: string, updates: Partial<ScopeItem>) {
    const res = await fetch(`/api/scope/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const updated = await res.json();
      setScopes((prev) =>
        prev.map((s) => ({
          ...s,
          items: s.items.map((i) => (i.id === id ? updated : i)),
        }))
      );
      router.refresh();
    }
  }

  async function deleteItem(id: string) {
    const res = await fetch(`/api/scope/${id}`, { method: "DELETE" });
    if (res.ok) {
      setScopes((prev) =>
        prev.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }))
      );
      router.refresh();
    }
  }

  async function addItem(scopeId: string) {
    const res = await fetch("/api/scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeId,
        segment: "New",
        task: "",
        material: "",
        quantity: 0,
        unit: "sqft",
        laborHours: 0,
      }),
    });
    if (res.ok) {
      const item = await res.json();
      setScopes((prev) =>
        prev.map((s) =>
          s.id === scopeId ? { ...s, items: [...s.items, item] } : s
        )
      );
      router.refresh();
    }
  }

  async function addScope() {
    const res = await fetch("/api/scopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name: "New scope",
        description: "",
      }),
    });
    if (res.ok) {
      const scope = await res.json();
      setScopes((prev) => [...prev, { ...scope, items: [] }]);
      router.refresh();
    }
  }

  const segments = new Map<string, number>();
  for (const scope of scopes) {
    for (const item of scope.items) {
      segments.set(item.segment, (segments.get(item.segment) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      {scopes.map((scope) => (
        <div key={scope.id} className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">{scope.name}</h3>
              <span className="text-xs text-slate-400">{scope.items.length} items</span>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => addItem(scope.id)}>
                <Plus className="size-3" />
                Add item
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-slate-500" onClick={addScope}>
                <Plus className="size-3" />
                Add scope
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {scope.items.map((item) => {
              const progress = item.progressPercent ?? 0;
              return (
                <div
                  key={item.id}
                  className="group relative rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md hover:border-slate-300 transition-all overflow-hidden"
                >
                  {/* Progress bar along top */}
                  {progress > 0 && (
                    <div className="h-1 bg-slate-100">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  <div className="p-3 space-y-2.5">
                    {/* Header: segment + source + delete */}
                    <div className="flex items-center gap-1.5">
                      <GripVertical className="size-3.5 text-slate-300 shrink-0" />
                      <input
                        value={item.segment}
                        onChange={(e) => updateLocalItem(scope.id, item.id, { segment: e.target.value })}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== item.segment) saveItem(item.id, { segment: v });
                        }}
                        className="text-xs font-semibold text-slate-500 uppercase tracking-wider bg-transparent border-none outline-none w-full focus:text-slate-900 placeholder:text-slate-300"
                        placeholder="Area"
                      />
                      <Badge
                        variant={item.source === "AI" ? "secondary" : "outline"}
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {item.source === "AI" ? (
                          <span className="flex items-center gap-0.5"><Sparkles className="size-2.5" /> AI</span>
                        ) : (
                          <span className="flex items-center gap-0.5"><Pen className="size-2.5" /> Manual</span>
                        )}
                      </Badge>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 shrink-0"
                        title="Remove item"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>

                    {/* Task (main label) */}
                    <div className="flex items-start gap-2">
                      <Hammer className="size-3.5 text-slate-400 mt-0.5 shrink-0" />
                      <input
                        value={item.task}
                        onChange={(e) => updateLocalItem(scope.id, item.id, { task: e.target.value })}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== item.task) saveItem(item.id, { task: v });
                        }}
                        className="text-sm font-medium text-slate-800 bg-transparent border-none outline-none w-full focus:text-slate-900 placeholder:text-slate-300"
                        placeholder="Describe the task..."
                      />
                    </div>

                    {/* Material */}
                    <div className="flex items-center gap-2">
                      <Package className="size-3.5 text-slate-400 shrink-0" />
                      <input
                        value={item.material}
                        onChange={(e) => updateLocalItem(scope.id, item.id, { material: e.target.value })}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== item.material) saveItem(item.id, { material: v });
                        }}
                        className="text-xs text-slate-600 bg-transparent border-none outline-none w-full focus:text-slate-900 placeholder:text-slate-300"
                        placeholder="Material..."
                      />
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-3 pt-1 border-t border-slate-100">
                      <div className="flex items-center gap-1" title="Quantity">
                        <Ruler className="size-3 text-slate-400" />
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) =>
                            updateLocalItem(scope.id, item.id, { quantity: parseFloat(e.target.value) || 0 })
                          }
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v !== item.quantity) saveItem(item.id, { quantity: v });
                          }}
                          className="text-xs text-slate-700 font-medium bg-transparent border-none outline-none w-12 tabular-nums"
                        />
                        <input
                          value={item.unit}
                          onChange={(e) => updateLocalItem(scope.id, item.id, { unit: e.target.value })}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== item.unit) saveItem(item.id, { unit: v });
                          }}
                          className="text-xs text-slate-500 bg-transparent border-none outline-none w-10"
                          placeholder="unit"
                        />
                      </div>

                      <div className="w-px h-3 bg-slate-200" />

                      <div className="flex items-center gap-1" title="Labor hours">
                        <Clock className="size-3 text-slate-400" />
                        <input
                          type="number"
                          value={item.laborHours ?? 0}
                          onChange={(e) =>
                            updateLocalItem(scope.id, item.id, { laborHours: parseFloat(e.target.value) || 0 })
                          }
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v !== (item.laborHours ?? 0)) saveItem(item.id, { laborHours: v });
                          }}
                          className="text-xs text-slate-700 font-medium bg-transparent border-none outline-none w-10 tabular-nums"
                        />
                        <span className="text-xs text-slate-400">hrs</span>
                      </div>

                      <div className="w-px h-3 bg-slate-200" />

                      <div className="flex items-center gap-1 ml-auto" title="Progress">
                        <div className={`size-2 rounded-full ${progress >= 100 ? "bg-emerald-500" : progress > 0 ? "bg-amber-400" : "bg-slate-200"}`} />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={progress}
                          onChange={(e) =>
                            updateLocalItem(scope.id, item.id, {
                              progressPercent: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
                            })
                          }
                          onBlur={(e) => {
                            const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                            if (v !== progress) saveItem(item.id, { progressPercent: v });
                          }}
                          className="text-xs text-slate-600 bg-transparent border-none outline-none w-8 tabular-nums text-right"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add item card */}
            <button
              onClick={() => addItem(scope.id)}
              className="rounded-xl border-2 border-dashed border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-50 transition-colors flex flex-col items-center justify-center gap-2 py-8 text-slate-400 hover:text-slate-500 min-h-[140px]"
            >
              <Plus className="size-5" />
              <span className="text-xs font-medium">Add item</span>
            </button>
          </div>
        </div>
      ))}

      {scopes.length === 0 && (
        <div className="text-center py-12">
          <LayoutGrid className="size-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-3">No scopes yet. Generate one from your job description above.</p>
          <Button variant="outline" size="sm" onClick={addScope} className="gap-1.5">
            <Plus className="size-3.5" />
            Create blank scope
          </Button>
        </div>
      )}
    </div>
  );
}
