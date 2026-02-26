import { getServerSession } from "next-auth";
import { authOptions, getOrCreateUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Calculator,
  Clock3,
  Compass,
  DollarSign,
  Home,
  MapPinned,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRelativeDate(input: Date) {
  const diffMs = Date.now() - input.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return input.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

type ActivityComparable = {
  price?: number;
  weight?: "local" | "reference";
};

type ActivityPayload = {
  estimatedValueAdd?: number;
  confidence?: string;
  comparablesSummary?: string;
  comparables?: ActivityComparable[];
  usedWebSearch?: boolean;
};

function compactText(input: string, max = 180) {
  const clean = input.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function tryParseActivityPayload(raw?: string | null): ActivityPayload | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  if (!(text.startsWith("{") || text.startsWith("["))) return null;
  try {
    return JSON.parse(text) as ActivityPayload;
  } catch {
    return null;
  }
}

function formatPriceRange(values: number[]) {
  const valid = values.filter((n) => Number.isFinite(n) && n > 0);
  if (valid.length === 0) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (min === max) return formatCurrency(min);
  return `${formatCurrency(min)}-${formatCurrency(max)}`;
}

export default async function ProjectsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const userId = await getOrCreateUserId(session);
  if (!userId) return null;
  const [
    projectCount,
    userPropertyCount,
    flipSearchCount,
    estimateCount,
    recentProjects,
    latestEstimate,
    recentFlipSearches,
  ] = await Promise.all([
    prisma.project.count({ where: { userId } }),
    prisma.userProperty.count({ where: { userId } }),
    prisma.flipSearch.count({ where: { userId } }),
    prisma.estimate.count({ where: { project: { userId } } }),
    prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        _count: { select: { photos: true } },
        scopes: { include: { _count: { select: { items: true } } } },
      },
    }),
    prisma.estimate.findFirst({
      where: { project: { userId } },
      orderBy: { updatedAt: "desc" },
      select: {
        updatedAt: true,
        grandTotal: true,
        confirmedAmount: true,
        project: { select: { id: true, address: true } },
      },
    }),
    prisma.flipSearch.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        updatedAt: true,
        marketType: true,
        comparablesFound: true,
        title: true,
        project: { select: { id: true, address: true, province: true } },
      },
    }),
  ]);

  const marketMix = recentFlipSearches.reduce<Record<string, number>>((acc, item) => {
    const key = (item.marketType ?? "unknown").toLowerCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const topMarketTypes = Object.entries(marketMix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const latestEstimateValue = latestEstimate?.confirmedAmount ?? latestEstimate?.grandTotal;
  const recentActivity = recentFlipSearches.map((search) => {
    const payload = tryParseActivityPayload(search.comparablesFound);
    const localPrices =
      payload?.comparables
        ?.filter((c) => c.weight !== "reference")
        .map((c) => Number(c.price))
        .filter((n) => Number.isFinite(n) && n > 0) ?? [];
    const refPrices =
      payload?.comparables
        ?.filter((c) => c.weight === "reference")
        .map((c) => Number(c.price))
        .filter((n) => Number.isFinite(n) && n > 0) ?? [];
    const localRange = formatPriceRange(localPrices);
    const refRange = formatPriceRange(refPrices);
    const summary =
      payload?.comparablesSummary && payload.comparablesSummary.trim()
        ? compactText(payload.comparablesSummary, 210)
        : search.comparablesFound
          ? compactText(search.comparablesFound, 210)
          : null;
    return {
      ...search,
      payload,
      localRange,
      refRange,
      summary,
      comparableCount: payload?.comparables?.length ?? 0,
    };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-600">Overview of projects, market activity, and recent valuation work</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/settings">Settings</Link>
          </Button>
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="size-4 mr-1.5" />
              New Project
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-slate-500">Total projects</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{projectCount}</p>
              <Building2 className="size-5 text-slate-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-slate-500">Estimates generated</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{estimateCount}</p>
              <DollarSign className="size-5 text-slate-500" />
            </div>
            {latestEstimateValue != null && latestEstimate ? (
              <p className="mt-2 text-xs text-slate-500">
                Latest {formatCurrency(latestEstimateValue)} on{" "}
                <Link className="text-slate-700 hover:underline" href={`/projects/${latestEstimate.project.id}`}>
                  {latestEstimate.project.address}
                </Link>
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No estimate data yet</p>
            )}
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-slate-500">Saved flip searches</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{flipSearchCount}</p>
              <Calculator className="size-5 text-slate-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-slate-500">Your comparables</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{userPropertyCount}</p>
              <Home className="size-5 text-slate-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-slate-900 flex items-center gap-2">
              <MapPinned className="size-4" />
              Recent real estate activity
            </CardTitle>
            <CardDescription>Latest flip intelligence and comparables context</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-slate-500">No flip searches yet. Run one from a project to populate this feed.</p>
            ) : (
              <ul className="space-y-3">
                {recentActivity.map((search) => (
                  <li key={search.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/projects/${search.project.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {search.title?.trim() || search.project.address}
                      </Link>
                      <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                        <Clock3 className="size-3.5" />
                        {formatRelativeDate(search.updatedAt)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="secondary">{search.project.province}</Badge>
                      <Badge variant="outline" className="capitalize">
                        {search.marketType ? search.marketType.replace("_", " ") : "market type pending"}
                      </Badge>
                      {typeof search.payload?.estimatedValueAdd === "number" && (
                        <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">
                          Value add {formatCurrency(search.payload.estimatedValueAdd)}
                        </Badge>
                      )}
                      {search.payload?.confidence && (
                        <Badge variant="outline" className="capitalize">
                          {search.payload.confidence} confidence
                        </Badge>
                      )}
                      {search.payload?.usedWebSearch && (
                        <Badge variant="outline">web-backed</Badge>
                      )}
                    </div>
                    {(search.localRange || search.refRange || search.comparableCount > 0) && (
                      <div className="mt-2 text-xs text-slate-600 space-y-0.5">
                        {search.localRange && (
                          <p>
                            <span className="font-medium text-slate-700">Local:</span> {search.project.address.split(",")[0]} {search.localRange}
                          </p>
                        )}
                        <p>
                          <span className="font-medium text-slate-700">Reference:</span>{" "}
                          {search.refRange ?? "None"}
                        </p>
                        {search.comparableCount > 0 && (
                          <p>
                            <span className="font-medium text-slate-700">Comparables:</span> {search.comparableCount}
                          </p>
                        )}
                      </div>
                    )}
                    {search.summary && (
                      <p className="mt-2 text-xs text-slate-600 line-clamp-3">{search.summary}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-slate-900 flex items-center gap-2">
              <Compass className="size-4" />
              Market snapshot
            </CardTitle>
            <CardDescription>Recent market signals from saved searches</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Top market types</p>
              {topMarketTypes.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No market data yet</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {topMarketTypes.map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between text-sm">
                      <span className="capitalize text-slate-700">{type.replace("_", " ")}</span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="pt-2 border-t border-slate-200">
              <p className="text-xs uppercase tracking-wider text-slate-500">Quick actions</p>
              <div className="mt-2 flex flex-col gap-2">
                <Button asChild variant="secondary" className="justify-between">
                  <Link href="/projects/new">
                    Start new project
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-between">
                  <Link href="/settings">
                    Update pricing settings
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-slate-900 flex items-center gap-2">
            <BarChart3 className="size-4" />
            Recent projects
          </CardTitle>
          <CardDescription>Open a project to continue scope, estimate, or real estate work</CardDescription>
        </CardHeader>
        <CardContent>
          {recentProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="text-slate-600 mb-4">No projects yet</p>
              <Button asChild>
                <Link href="/projects/new">Create your first project</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {recentProjects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  <Card className="border-slate-200 bg-white hover:shadow-md hover:border-slate-300 transition-all h-full">
                    <CardHeader>
                      <CardTitle className="text-slate-900 text-base">{p.address}</CardTitle>
                      <CardDescription>
                        {p.province} · {p.sqft} sqft
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{p._count.photos} photos</Badge>
                        <Badge variant="outline">
                          {p.scopes.reduce((n, s) => n + s._count.items, 0)} scope items
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
