"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Package, ReceiptText, Trash2, Upload } from "lucide-react";

type FlyerItem = {
  id: string;
  name: string;
  unitLabel: string | null;
  price: number;
  promoNotes: string | null;
  rawText: string | null;
};

type Flyer = {
  id: string;
  imageUrl: string;
  storeName: string | null;
  releaseDate: string | null;
  parsedSummary: string | null;
  items: FlyerItem[];
};

function isPdfUrl(url: string): boolean {
  return /\.pdf(?:$|\?)/i.test(url);
}

function toDateInput(dateIso: string | null): string {
  if (!dateIso) return "";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function FlyerLibraryCard() {
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const flyerCount = flyers.length;
  const itemCount = useMemo(
    () => flyers.reduce((sum, flyer) => sum + (flyer.items?.length ?? 0), 0),
    [flyers]
  );

  async function loadFlyers() {
    setLoading(true);
    try {
      const res = await fetch("/api/flyers", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data.flyers) ? (data.flyers as Flyer[]) : [];
      setFlyers(list);
      setExpanded((prev) => {
        const next = { ...prev };
        for (const f of list) {
          if (next[f.id] == null) next[f.id] = false;
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFlyers();
  }, []);

  async function uploadFlyer(form: FormData) {
    setUploading(true);
    try {
      const res = await fetch("/api/flyers/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) return;
      await loadFlyers();
    } finally {
      setUploading(false);
    }
  }

  async function patchFlyer(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/flyers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as Flyer;
    setFlyers((prev) => prev.map((f) => (f.id === id ? updated : f)));
  }

  async function patchItem(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/flyers/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as FlyerItem;
    setFlyers((prev) =>
      prev.map((f) => ({
        ...f,
        items: f.items.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)),
      }))
    );
  }

  async function deleteFlyer(id: string) {
    const res = await fetch(`/api/flyers/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setFlyers((prev) => prev.filter((f) => f.id !== id));
  }

  async function deleteFlyerItem(id: string) {
    const res = await fetch(`/api/flyers/items/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setFlyers((prev) =>
      prev.map((f) => ({
        ...f,
        items: f.items.filter((i) => i.id !== id),
      }))
    );
  }

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-slate-900">Flyer Library</CardTitle>
            <CardDescription className="text-slate-600">
              Parse hardware flyers into reusable pricing context for estimates and deep dives.
            </CardDescription>
          </div>
          <div className="text-xs text-slate-500">
            {flyerCount} flyer{flyerCount === 1 ? "" : "s"} · {itemCount} item{itemCount === 1 ? "" : "s"}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement | null;
            if (!fileInput?.files?.length) return;
            const fd = new FormData();
            for (const file of Array.from(fileInput.files)) fd.append("files", file);
            const storeName = (form.querySelector('input[name="storeName"]') as HTMLInputElement | null)?.value;
            const releaseDate = (form.querySelector('input[name="releaseDate"]') as HTMLInputElement | null)?.value;
            if (storeName?.trim()) fd.append("storeName", storeName.trim());
            if (releaseDate?.trim()) fd.append("releaseDate", releaseDate.trim());
            void uploadFlyer(fd);
            fileInput.value = "";
          }}
          className="grid gap-2 md:grid-cols-4"
        >
          <Input type="file" accept="image/*,.pdf,application/pdf" multiple className="md:col-span-2" />
          <Input name="storeName" placeholder="Store name (optional)" />
          <Input name="releaseDate" type="date" />
          <Button type="submit" disabled={uploading} className="md:col-span-4 justify-center gap-1.5">
            <Upload className="size-4" />
            {uploading ? "Uploading + parsing..." : "Upload flyer photos or PDF"}
          </Button>
        </form>

        {loading && flyers.length === 0 && (
          <p className="text-sm text-slate-500">Loading flyer library...</p>
        )}

        {flyers.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No flyers saved yet. Upload a hardware-store flyer to build local pricing memory.
          </div>
        ) : (
          <div className="space-y-3">
            {flyers.map((flyer) => (
              <div key={flyer.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex flex-wrap items-start gap-3">
                  {isPdfUrl(flyer.imageUrl) ? (
                    <a
                      href={flyer.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="h-20 w-20 rounded-md border border-slate-200 bg-white flex flex-col items-center justify-center text-slate-500 hover:text-blue-600"
                      title="Open flyer PDF"
                    >
                      <ReceiptText className="size-6" />
                      <span className="text-[10px] mt-1">PDF</span>
                    </a>
                  ) : (
                    <img
                      src={flyer.imageUrl}
                      alt={flyer.storeName ?? "Flyer"}
                      className="h-20 w-20 rounded-md border border-slate-200 bg-white object-cover"
                    />
                  )}
                  <div className="flex-1 min-w-[220px] grid gap-2 md:grid-cols-3">
                    <Input
                      defaultValue={flyer.storeName ?? ""}
                      placeholder="Store"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== (flyer.storeName ?? "")) {
                          void patchFlyer(flyer.id, { storeName: next || null });
                        }
                      }}
                    />
                    <Input
                      type="date"
                      defaultValue={toDateInput(flyer.releaseDate)}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        const prev = toDateInput(flyer.releaseDate);
                        if (next !== prev) {
                          void patchFlyer(flyer.id, { releaseDate: next || null });
                        }
                      }}
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [flyer.id]: !prev[flyer.id] }))
                        }
                      >
                        {expanded[flyer.id] ? "Hide items" : `Show items (${flyer.items.length})`}
                      </Button>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-rose-600 border-rose-200 hover:bg-rose-50"
                    onClick={() => void deleteFlyer(flyer.id)}
                  >
                    <Trash2 className="size-3.5 mr-1" />
                    Delete flyer
                  </Button>
                </div>

                <Textarea
                  defaultValue={flyer.parsedSummary ?? ""}
                  placeholder="Parsed summary notes (optional)"
                  rows={2}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next !== (flyer.parsedSummary ?? "")) {
                      void patchFlyer(flyer.id, { parsedSummary: next || null });
                    }
                  }}
                />

                {expanded[flyer.id] && (
                  <div className="space-y-2">
                    {flyer.items.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No rows extracted. You can still keep this flyer for reference.
                      </p>
                    ) : (
                      flyer.items.map((item) => (
                        <div
                          key={item.id}
                          className="rounded border border-slate-200 bg-white p-2 grid gap-2 md:grid-cols-12"
                        >
                          <div className="md:col-span-4">
                            <Input
                              defaultValue={item.name}
                              onBlur={(e) => {
                                const next = e.target.value.trim();
                                if (next && next !== item.name) {
                                  void patchItem(item.id, { name: next });
                                }
                              }}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Input
                              defaultValue={item.unitLabel ?? ""}
                              placeholder="Unit"
                              onBlur={(e) => {
                                const next = e.target.value.trim();
                                if (next !== (item.unitLabel ?? "")) {
                                  void patchItem(item.id, { unitLabel: next || null });
                                }
                              }}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Input
                              type="number"
                              defaultValue={Number(item.price)}
                              onBlur={(e) => {
                                const next = Number(e.target.value);
                                if (Number.isFinite(next) && next > 0 && next !== item.price) {
                                  void patchItem(item.id, { price: next });
                                }
                              }}
                            />
                          </div>
                          <div className="md:col-span-3">
                            <Input
                              defaultValue={item.promoNotes ?? ""}
                              placeholder="Notes"
                              onBlur={(e) => {
                                const next = e.target.value.trim();
                                if (next !== (item.promoNotes ?? "")) {
                                  void patchItem(item.id, { promoNotes: next || null });
                                }
                              }}
                            />
                          </div>
                          <div className="md:col-span-1 flex items-center justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                              onClick={() => void deleteFlyerItem(item.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="text-xs text-slate-500 flex items-center gap-2">
          <ReceiptText className="size-3.5" />
          Edits save on blur. Deleting a flyer removes all extracted rows.
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <Package className="size-3.5" />
          Matching flyer rows are used as local pricing signals in estimate generation and deep dives.
        </div>
      </CardContent>
    </Card>
  );
}
