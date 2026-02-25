import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
} from "@react-pdf/renderer";

// Note: @react-pdf/renderer requires renderToBuffer from react-pdf for server
// We'll use a simpler approach: generate HTML and convert, or use pdf-lib
// For MVP, we'll return a simple HTML invoice that can be printed to PDF

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const estimateId = req.nextUrl.searchParams.get("estimateId");

  if (!estimateId) {
    return NextResponse.json({ error: "estimateId required" }, { status: 400 });
  }

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId },
    include: {
      project: true,
      lines: { include: { scopeItem: true } },
    },
  });

  if (!estimate || estimate.project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const html = renderInvoiceHtml(estimate);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "inline; filename=invoice.html",
    },
  });
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(n);
}

function renderInvoiceHtml(estimate: {
  id: string;
  status: string;
  grandTotal: number;
  totalLabor: number;
  totalMaterial: number;
  totalMarkup: number;
  totalTax: number;
  sealedAt: Date | null;
  assumptions: unknown;
  project: { address: string; province: string; sqft: string };
  lines: Array<{
    laborCost: number;
    materialCost: number;
    markup: number;
    tax: number;
    scopeItem: { segment: string; task: string; material: string; quantity: number; unit: string };
  }>;
}) {
  const assumptions = (estimate.assumptions ?? null) as Record<string, unknown> | null;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice - ${estimate.project.address}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #1e293b; }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 1rem; margin-bottom: 2rem; }
    .header h1 { margin: 0; font-size: 1.5rem; }
    .header .sub { color: #64748b; font-size: 0.9rem; }
    .status { display: inline-block; padding: 0.25rem 0.5rem; background: #0f172a; color: white; border-radius: 4px; font-size: 0.75rem; margin-top: 0.5rem; }
    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
    th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; font-weight: 600; }
    .num { text-align: right; }
    .totals { margin-top: 2rem; padding-top: 1rem; border-top: 2px solid #0f172a; }
    .totals .row { display: flex; justify-content: space-between; padding: 0.25rem 0; }
    .totals .grand { font-size: 1.25rem; font-weight: 700; margin-top: 0.5rem; }
    .footer { margin-top: 3rem; font-size: 0.75rem; color: #64748b; }
    @media print { body { padding: 1rem; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Work Estimate / Invoice</h1>
    <p class="sub">${estimate.project.address} · ${estimate.project.province} · ${estimate.project.sqft} sqft</p>
    <span class="status">${estimate.status.toUpperCase()}</span>
    ${estimate.sealedAt ? `<p class="sub">Sealed: ${new Date(estimate.sealedAt).toLocaleDateString("en-CA")}</p>` : ""}
  </div>

  <table>
    <thead>
      <tr>
        <th>Segment</th>
        <th>Task</th>
        <th class="num">Labor</th>
        <th class="num">Material</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${estimate.lines
        .map(
          (l) => `
      <tr>
        <td>${l.scopeItem.segment}</td>
        <td>${l.scopeItem.task}</td>
        <td class="num">${formatCurrency(l.laborCost)}</td>
        <td class="num">${formatCurrency(l.materialCost)}</td>
        <td class="num">${formatCurrency(l.laborCost + l.materialCost + l.markup + l.tax)}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Labor</span><span>${formatCurrency(estimate.totalLabor)}</span></div>
    <div class="row"><span>Materials</span><span>${formatCurrency(estimate.totalMaterial)}</span></div>
    <div class="row"><span>Markup</span><span>${formatCurrency(estimate.totalMarkup)}</span></div>
    <div class="row"><span>Tax</span><span>${formatCurrency(estimate.totalTax)}</span></div>
    <div class="row grand"><span>Total</span><span>${formatCurrency(estimate.grandTotal)}</span></div>
  </div>

  ${assumptions ? `
  <div class="footer">
    <p>Assumptions: Labor rate ${assumptions.laborRate}/hr, ${assumptions.taxName} applied. Estimate ID: ${estimate.id}</p>
  </div>
  ` : ""}

  <p class="footer" style="margin-top: 2rem;">AI Invoice Maker · Use Print (Ctrl+P) to save as PDF</p>
</body>
</html>`;
}
