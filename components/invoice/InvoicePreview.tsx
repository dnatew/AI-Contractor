"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Estimate, EstimateLine, ScopeItem } from "@prisma/client";

type EstimateWithLines = Estimate & {
  lines: (EstimateLine & { scopeItem: ScopeItem })[];
};

type InvoicePreviewProps = {
  projectId: string;
  projectAddress: string;
  estimate: EstimateWithLines | null;
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(n);
}

export function InvoicePreview({
  projectId,
  projectAddress,
  estimate,
}: InvoicePreviewProps) {
  const router = useRouter();
  const [sealing, setSealing] = useState(false);
  const [confirmedAmount, setConfirmedAmount] = useState<string>(
    estimate?.confirmedAmount != null ? String(estimate.confirmedAmount) : ""
  );

  async function seal() {
    if (!estimate) return;
    setSealing(true);
    try {
      const body: { estimateId: string; confirmedAmount?: number } = { estimateId: estimate.id };
      const amt = parseFloat(confirmedAmount);
      if (!isNaN(amt) && amt > 0) body.confirmedAmount = amt;
      const res = await fetch("/api/estimates/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setSealing(false);
    }
  }

  function exportInvoice() {
    if (!estimate) return;
    window.open(`/api/invoices/export?estimateId=${estimate.id}`, "_blank", "noopener");
  }

  if (!estimate) {
    return (
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-slate-900">Invoice Draft</CardTitle>
          <CardDescription className="text-slate-600">Generate an estimate first, then seal and export</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-slate-600">Go to the Estimate tab and click Generate Estimate</p>
        </CardContent>
      </Card>
    );
  }

  const isSealed = estimate.status === "sealed";

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-slate-900">Invoice Draft</CardTitle>
            <CardDescription className="text-slate-600">{projectAddress}</CardDescription>
          </div>
          <Badge variant={isSealed ? "default" : "secondary"}>{estimate.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-600">Generated total</span>
            <span className="text-xl font-bold text-slate-900">
              {formatCurrency(estimate.grandTotal)}
            </span>
          </div>
          {!isSealed && (
            <div className="mt-2">
              <label className="text-xs text-slate-500 block mb-1">Confirmed quote (optional)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Override with your confirmed amount"
                value={confirmedAmount}
                onChange={(e) => setConfirmedAmount(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          )}
          {isSealed && estimate.confirmedAmount != null && (
            <p className="text-sm text-emerald-600 mt-2">
              Confirmed: {formatCurrency(estimate.confirmedAmount)}
            </p>
          )}
          <p className="text-xs text-slate-500 mt-2">
            {estimate.lines.length} line items
          </p>
        </div>

        <div className="flex gap-2">
          {!isSealed && (
            <Button onClick={seal} disabled={sealing}>
              {sealing ? "Sealing..." : "Seal Estimate"}
            </Button>
          )}
          <Button variant="outline" onClick={exportInvoice}>
            Export (HTML/Print to PDF)
          </Button>
        </div>

        {isSealed && (
          <p className="text-sm text-slate-600">
            Sealed on {estimate.sealedAt ? new Date(estimate.sealedAt).toLocaleDateString("en-CA") : "—"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
