import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Calculator,
  CheckCircle2,
  FileCheck2,
  Home,
  MapPinned,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const FEATURES = [
  {
    title: "AI scope generation",
    description: "Turn job notes into clean, editable scope items with contractor-friendly phrasing.",
    icon: Sparkles,
  },
  {
    title: "Estimate breakdowns",
    description: "Generate labor + material line items with clear costs and sources.",
    icon: FileCheck2,
  },
  {
    title: "Real estate impact",
    description: "Compare renovation value against market data and your own deal history.",
    icon: MapPinned,
  },
  {
    title: "Flip calculator",
    description: "Model purchase, renovation, hold, and sale outcomes with ROI guidance.",
    icon: Calculator,
  },
];

const STEPS = [
  {
    title: "Create your project",
    text: "Enter property details, address, and job context to anchor pricing and comps.",
  },
  {
    title: "Refine scopes and estimate",
    text: "Adjust AI scope items, apply your own rates, and generate a client-ready quote.",
  },
  {
    title: "Track value + decisions",
    text: "Use real estate and flip insights to prioritize work with the best return.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white">
      <section className="relative overflow-hidden border-b border-slate-200">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -left-16 h-72 w-72 rounded-full bg-cyan-200/35 blur-3xl" />
          <div className="absolute -bottom-20 right-0 h-80 w-80 rounded-full bg-emerald-200/35 blur-3xl" />
        </div>
        <div className="relative container mx-auto px-4 py-20 lg:py-28">
          <Badge variant="outline" className="mb-4 bg-white/80">
            Built for Canadian contractors
          </Badge>
          <h1 className="max-w-4xl text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900">
            From renovation scope to pricing, comps, and flip decisions in one workflow
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-600">
            AI Contractor helps you quote faster, compare market value impact, and manage repeatable renovation
            decisions with data from your own projects.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/login">
                Get Started
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/projects">See Dashboard</Link>
            </Button>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-slate-600">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Scope + estimate workflow
            </span>
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Real estate comparables + maps
            </span>
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Flip tracking and saved scenarios
            </span>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900">Everything in one contractor workspace</h2>
            <p className="mt-2 text-slate-600">Practical tools designed for real quotes and real resale decisions.</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg text-slate-900">
                  <feature.icon className="size-5 text-slate-700" />
                  {feature.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-600">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white/80">
        <div className="container mx-auto px-4 py-16">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900">How it works</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, idx) => (
              <Card key={step.title} className="border-slate-200 shadow-sm">
                <CardHeader className="pb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Step {idx + 1}</p>
                  <CardTitle className="text-slate-900">{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600">{step.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <BarChart3 className="size-4 text-cyan-700" />
                Faster quoting cycles
              </div>
              <p className="mt-2 text-sm text-slate-600">Go from intake to priced estimate without rebuilding scope manually.</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <Home className="size-4 text-emerald-700" />
                Better project decisions
              </div>
              <p className="mt-2 text-sm text-slate-600">See value impact and market context before committing spend.</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <Calculator className="size-4 text-indigo-700" />
                Repeatable ROI workflow
              </div>
              <p className="mt-2 text-sm text-slate-600">Use your historical flips as the anchor for future deals.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20">
        <Card className="border-slate-200 bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-lg">
          <CardContent className="py-10 px-6 md:px-10 flex flex-col md:flex-row gap-6 md:items-center md:justify-between">
            <div>
              <h3 className="text-2xl font-semibold">Ready to run your next quote smarter?</h3>
              <p className="mt-2 text-slate-200 max-w-xl">
                Start with one project and build your own local pricing + value playbook as you go.
              </p>
            </div>
            <Button asChild size="lg" className="bg-white text-slate-900 hover:bg-slate-100">
              <Link href="/login">Open the app</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
