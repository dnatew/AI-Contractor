"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PhotoUploader } from "@/components/photo-uploader";
import { ScopeEditor } from "@/components/scope/ScopeEditor";
import { ScopeFinishesGallery } from "@/components/scope/ScopeFinishesGallery";
import { Badge } from "@/components/ui/badge";
import { PricingBreakdown } from "@/components/pricing/PricingBreakdown";
import { InvoicePreview } from "@/components/invoice/InvoicePreview";
import { RealEstatePanel } from "@/components/real-estate/RealEstatePanel";
import { FlipCalculator } from "@/components/flip/FlipCalculator";
import { Sparkles, Lightbulb, MessageSquare } from "lucide-react";
import Link from "next/link";
import type { Project, Photo, Scope, ScopeItem, Estimate, EstimateLine } from "@prisma/client";

const WORK_TYPE_LABELS: Record<string, string> = {
  flooring: "Flooring", kitchen: "Kitchen reno", bathroom: "Bathroom reno",
  painting: "Painting", drywall: "Drywall", tiling: "Tiling",
  baseboard_trim: "Baseboard / Trim", demolition: "Demolition",
  plumbing: "Plumbing", electrical: "Electrical", other: "Other",
};

const ROOM_LABELS: Record<string, string> = {
  kitchen: "Kitchen", bathroom: "Bathroom", living_room: "Living Room",
  bedroom: "Bedroom", basement: "Basement", hallway: "Hallway",
  laundry: "Laundry", whole_house: "Whole house", other: "Other",
};

type ProjectWithRelations = Project & {
  photos: Photo[];
  scopes: (Scope & { items: ScopeItem[] })[];
  estimates: (Estimate & { lines: (EstimateLine & { scopeItem: ScopeItem })[] })[];
};

export function ProjectWorkspace({ project }: { project: ProjectWithRelations }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("scope");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tweakPrompt, setTweakPrompt] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [description, setDescription] = useState(project.jobPrompt ?? "");
  const [savingDesc, setSavingDesc] = useState(false);
  const [loadingWizard, setLoadingWizard] = useState(false);
  const [wizardQuestions, setWizardQuestions] = useState<Array<{ id: string; question: string; placeholder?: string }>>([]);
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string>>({});

  const totalItems = project.scopes.reduce((acc, s) => acc + s.items.length, 0);
  const workTypes = project.workTypes?.split(",").filter(Boolean) ?? [];
  const rooms = project.rooms?.split(",").filter(Boolean) ?? [];
  const allItems = project.scopes.flatMap((s) => s.items);

  const suggestions = useMemo(() => {
    if (totalItems === 0) return [];
    const tips: { label: string; prompt: string }[] = [];

    const segments = new Set(allItems.map((i) => i.segment.toLowerCase()));
    const tasks = allItems.map((i) => i.task.toLowerCase());

    // Rooms selected but not represented in scope
    for (const room of rooms) {
      const roomLabel = ROOM_LABELS[room] ?? room.replace(/_/g, " ");
      const found = Array.from(segments).some(
        (s) => s.includes(roomLabel.toLowerCase()) || roomLabel.toLowerCase().includes(s)
      );
      if (!found) {
        tips.push({ label: `Add ${roomLabel} scope`, prompt: `Add scope items for ${roomLabel}` });
      }
    }

    // Work types selected but not represented
    for (const wt of workTypes) {
      const label = WORK_TYPE_LABELS[wt] ?? wt;
      const found = tasks.some((t) => t.includes(wt.replace(/_/g, " ")) || t.includes(label.toLowerCase()));
      if (!found && wt !== "other") {
        tips.push({ label: `Add ${label.toLowerCase()}`, prompt: `Add ${label.toLowerCase()} work items` });
      }
    }

    // Bathroom-specific breakdowns
    if (segments.has("bathroom") || rooms.includes("bathroom")) {
      const bathroomItems = allItems.filter((i) => i.segment.toLowerCase().includes("bathroom"));
      if (bathroomItems.length <= 2) {
        tips.push({ label: "Break bathroom into vanity, tile, fixtures", prompt: "Break bathroom scope into separate items: vanity/sink, tile/flooring, fixtures, and painting" });
      }
    }

    // Kitchen-specific breakdowns
    if (segments.has("kitchen") || rooms.includes("kitchen")) {
      const kitchenItems = allItems.filter((i) => i.segment.toLowerCase().includes("kitchen"));
      if (kitchenItems.length <= 2) {
        tips.push({ label: "Break kitchen into cabinets, counters, flooring", prompt: "Break kitchen scope into separate items: cabinets, countertops, flooring, backsplash, and painting" });
      }
    }

    // Bedrooms - suggest separating
    const bedroomItems = allItems.filter((i) => i.segment.toLowerCase().includes("bedroom"));
    if (bedroomItems.length >= 2 && new Set(bedroomItems.map((i) => i.segment)).size === 1) {
      tips.push({ label: "Separate bedrooms individually", prompt: "Keep each bedroom as its own segment (Bedroom 1, Bedroom 2, etc.) with individual scope items" });
    }

    // Missing common tasks
    const hasDemolition = tasks.some((t) => /\b(demo|remov|rip|tear)\b/.test(t));
    if (!hasDemolition && totalItems > 2) {
      tips.push({ label: "Add demolition / removal", prompt: "Add demolition and removal items where old materials need to come out first" });
    }

    const hasCleanup = tasks.some((t) => /\b(clean|haul|dispos|dump)\b/.test(t));
    if (!hasCleanup && totalItems > 3) {
      tips.push({ label: "Add cleanup & disposal", prompt: "Add a cleanup and debris disposal/hauling item" });
    }

    // Too many or too few items
    if (totalItems > 10) {
      tips.push({ label: "Consolidate into fewer items", prompt: "Consolidate scope into 7-8 major work packages, combining related sub-tasks" });
    }
    if (totalItems < 4 && rooms.length > 1) {
      tips.push({ label: "Add more detail per room", prompt: "Break scope into more items — each room should have its own scope line" });
    }

    // Material suggestions
    if (project.materialGrade === "premium" && tasks.some((t) => t.includes("vinyl"))) {
      tips.push({ label: "Upgrade to hardwood", prompt: "Replace vinyl plank with engineered hardwood to match premium material grade" });
    }

    return tips.slice(0, 6);
  }, [allItems, totalItems, rooms, workTypes, project.materialGrade]);

  async function saveDescription() {
    setSavingDesc(true);
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobPrompt: description || null }),
      });
      setEditingDesc(false);
      router.refresh();
    } finally {
      setSavingDesc(false);
    }
  }

  async function fetchWizardQuestions() {
    setLoadingWizard(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          mode: "questions",
        }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (Array.isArray(data.questions) && data.questions.length > 0) {
        setWizardQuestions(data.questions);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setLoadingWizard(false);
    }
  }

  async function generateScope(opts?: { skipWizard?: boolean }) {
    if (!opts?.skipWizard && totalItems === 0 && !tweakPrompt.trim() && wizardQuestions.length === 0) {
      const opened = await fetchWizardQuestions();
      if (opened) return;
    }

    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          tweakPrompt: tweakPrompt.trim() || undefined,
          refinementAnswers: wizardAnswers,
        }),
      });
      if (res.ok) {
        if (tweakPrompt.trim()) {
          setDescription((prev) => prev ? `${prev}\n\nUpdate: ${tweakPrompt.trim()}` : tweakPrompt.trim());
          setTweakPrompt("");
        }
        setWizardQuestions([]);
        setWizardAnswers({});
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Generation failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList className="bg-slate-100 border border-slate-200 text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
        <TabsTrigger value="scope">Scope</TabsTrigger>
        <TabsTrigger value="estimate">Estimate</TabsTrigger>
        <TabsTrigger value="realestate">Real Estate</TabsTrigger>
        <TabsTrigger value="flip">Flip Calculator</TabsTrigger>
        <TabsTrigger value="invoice">Invoice</TabsTrigger>
      </TabsList>

      <TabsContent value="scope" className="space-y-4">
        {/* Job summary */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-slate-900">Job Summary</CardTitle>
                <CardDescription className="text-slate-600">
                  {project.address} - {project.sqft} sqft
                </CardDescription>
              </div>
              <Link href={`/projects/${project.id}/edit`}>
                <Button variant="outline" size="sm">Edit</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(workTypes.length > 0 || rooms.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {workTypes.map((w) => (
                  <Badge key={w} variant="secondary" className="text-xs">
                    {WORK_TYPE_LABELS[w] ?? w}
                  </Badge>
                ))}
                {rooms.map((r) => (
                  <Badge key={r} variant="outline" className="text-xs">
                    {ROOM_LABELS[r] ?? r}
                  </Badge>
                ))}
                {project.materialGrade && (
                  <Badge variant="outline" className="text-xs capitalize">
                    {project.materialGrade.replace("_", " ")}
                  </Badge>
                )}
              </div>
            )}

            {editingDesc ? (
              <div className="space-y-2">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="bg-white border-slate-300 text-sm"
                  placeholder="Describe the job in detail..."
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveDescription} disabled={savingDesc}>
                    {savingDesc ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingDesc(false); setDescription(project.jobPrompt ?? ""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : description ? (
              <div
                className="text-sm text-slate-700 whitespace-pre-line cursor-pointer rounded-lg border border-transparent hover:border-slate-200 hover:bg-slate-50 p-2 -m-2 transition-colors"
                onClick={() => setEditingDesc(true)}
                title="Click to edit"
              >
                {description}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No job description yet.{" "}
                <button onClick={() => setEditingDesc(true)} className="text-slate-900 underline">
                  Add one
                </button>{" "}
                to generate a scope.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Generate / refine scope */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="py-4 space-y-3">
            {wizardQuestions.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
                <p className="text-xs font-medium text-blue-700">
                  Quick scope wizard (optional) - answer what you know for better coverage.
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {wizardQuestions.map((q) => (
                    <div key={q.id} className="space-y-1">
                      <label className="text-[11px] text-slate-600">{q.question}</label>
                      <Input
                        value={wizardAnswers[q.id] ?? ""}
                        onChange={(e) =>
                          setWizardAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                        placeholder={q.placeholder ?? "Type answer..."}
                        className="h-8 bg-white"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => generateScope({ skipWizard: true })} disabled={generating}>
                    Continue with answers
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setWizardQuestions([]);
                      setWizardAnswers({});
                      void generateScope({ skipWizard: true });
                    }}
                    disabled={generating}
                  >
                    Skip wizard
                  </Button>
                </div>
              </div>
            )}

            {/* Suggestion bubbles */}
            {suggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <Lightbulb className="size-3" />
                  AI suggestions to refine your scope
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setTweakPrompt(s.prompt)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        tweakPrompt === s.prompt
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      <Sparkles className="size-3" />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Custom tweak input */}
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-1">
                <div className="relative">
                  <MessageSquare className="absolute left-2.5 top-2.5 size-3.5 text-slate-400 pointer-events-none" />
                  <Textarea
                    value={tweakPrompt}
                    onChange={(e) => setTweakPrompt(e.target.value)}
                    rows={2}
                    className="bg-white border-slate-300 text-sm pl-8 resize-none"
                    placeholder={totalItems > 0
                      ? "Refine scope — e.g. \"keep bedrooms separate\" or \"add pot lights in kitchen\""
                      : "Optional instructions for AI scope generation..."
                    }
                  />
                </div>
                {tweakPrompt.trim() && (
                  <p className="text-[11px] text-blue-600 flex items-center gap-1">
                    <Sparkles className="size-2.5" />
                    This refinement will take priority when regenerating.
                  </p>
                )}
              </div>
              <Button
                onClick={() => generateScope()}
                disabled={generating || loadingWizard}
                className="shrink-0 gap-1.5"
                size={tweakPrompt.trim() ? "default" : "sm"}
              >
                {generating || loadingWizard ? (
                  <span className="flex items-center gap-2">
                    <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {loadingWizard ? "Preparing..." : tweakPrompt.trim() ? "Refining..." : "Generating..."}
                  </span>
                ) : tweakPrompt.trim() ? (
                  <>
                    <Sparkles className="size-3.5" />
                    Refine Scope
                  </>
                ) : totalItems > 0 ? (
                  "Regenerate"
                ) : (
                  "Generate Scope"
                )}
              </Button>
            </div>

            {totalItems > 0 && !tweakPrompt.trim() && (
              <p className="text-xs text-slate-400">
                {totalItems} items across {project.scopes.length} scope(s) — pick a suggestion above or type your own refinement.
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </CardContent>
        </Card>

        <ScopeFinishesGallery
          projectId={project.id}
          scopeItems={allItems}
          onApplied={() => router.refresh()}
        />

        {/* Photos with notes */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-slate-900 text-base">Photos</CardTitle>
            <CardDescription className="text-slate-600">
              Add photos and describe what's in them - this helps AI generate a better scope
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PhotoUploader projectId={project.id} photos={project.photos} />
          </CardContent>
        </Card>

        {/* Scope items editor */}
        {project.scopes.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Scope Items</h3>
                <p className="text-sm text-slate-500">Review and edit the generated scope. Click any field to edit.</p>
              </div>
              <span className="text-xs text-slate-400 tabular-nums">{totalItems} items</span>
            </div>
            <ScopeEditor projectId={project.id} scopes={project.scopes} />
          </div>
        )}
      </TabsContent>

      <TabsContent value="estimate" className="space-y-4">
        <PricingBreakdown
          projectId={project.id}
          province={project.province}
          estimate={project.estimates[0] ?? null}
        />
      </TabsContent>

      <TabsContent value="realestate">
        <RealEstatePanel
          projectId={project.id}
          address={project.address}
          province={project.province}
          sqft={project.sqft}
          neighborhoodTier={project.neighborhoodTier}
          scopeItems={project.scopes.flatMap((s) => s.items)}
        />
      </TabsContent>

      <TabsContent value="flip">
        <FlipCalculator
          projectId={project.id}
          address={project.address}
          province={project.province}
          sqft={project.sqft}
          renovationCost={project.estimates[0]?.grandTotal ?? 0}
        />
      </TabsContent>

      <TabsContent value="invoice">
        <InvoicePreview
          projectId={project.id}
          projectAddress={project.address}
          estimate={project.estimates[0] ?? null}
        />
      </TabsContent>
    </Tabs>
  );
}
