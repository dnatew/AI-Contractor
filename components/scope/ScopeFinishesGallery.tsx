"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ImageIcon, Check, Plus } from "lucide-react";

type ScopeItemLite = {
  id: string;
  segment: string;
  task: string;
  material: string;
  quantity: number;
  unit: string;
};

type GalleryIdea = {
  id: string;
  title: string;
  caption: string;
  imageUrl: string;
  suggestedSegment: string;
  suggestedTask: string;
  materialHint: string;
  quantityHint: number;
  unitHint: string;
  confidence: number;
  searchQuery: string;
};

type DetailQuestion = {
  id: string;
  question: string;
  placeholder?: string;
  required?: boolean;
};

export function ScopeFinishesGallery({
  projectId,
  scopeItems,
  onApplied,
}: {
  projectId: string;
  scopeItems: ScopeItemLite[];
  onApplied?: () => void;
}) {
  const [ideas, setIdeas] = useState<GalleryIdea[]>([]);
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [selectedIdeaIds, setSelectedIdeaIds] = useState<Set<string>>(new Set());
  const [questionsByIdeaId, setQuestionsByIdeaId] = useState<Record<string, DetailQuestion[]>>({});
  const [answersByIdeaId, setAnswersByIdeaId] = useState<Record<string, Record<string, string>>>({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIdeas = useMemo(
    () => ideas.filter((i) => selectedIdeaIds.has(i.id)),
    [ideas, selectedIdeaIds]
  );

  async function loadIdeas() {
    setLoadingIdeas(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/scope-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, mode: "ideas" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to load gallery ideas.");
        return;
      }
      const data = await res.json();
      const fetchedIdeas = Array.isArray(data.ideas) ? (data.ideas as GalleryIdea[]) : [];
      setIdeas(fetchedIdeas);
    } catch {
      setError("Network error while loading gallery ideas.");
    } finally {
      setLoadingIdeas(false);
    }
  }

  function toggleIdea(ideaId: string) {
    setSelectedIdeaIds((prev) => {
      const next = new Set(prev);
      if (next.has(ideaId)) next.delete(ideaId);
      else next.add(ideaId);
      return next;
    });
  }

  async function fetchDetailQuestions() {
    if (selectedIdeas.length === 0) return;
    setLoadingDetails(true);
    setError(null);
    try {
      for (const idea of selectedIdeas) {
        if (questionsByIdeaId[idea.id]?.length) continue;
        const res = await fetch("/api/ai/scope-gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            mode: "detail_questions",
            idea,
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const questions = Array.isArray(data.questions) ? (data.questions as DetailQuestion[]) : [];
        setQuestionsByIdeaId((prev) => ({ ...prev, [idea.id]: questions }));
      }
    } catch {
      setError("Failed to load detail questions.");
    } finally {
      setLoadingDetails(false);
    }
  }

  function updateAnswer(ideaId: string, questionId: string, value: string) {
    setAnswersByIdeaId((prev) => ({
      ...prev,
      [ideaId]: {
        ...(prev[ideaId] ?? {}),
        [questionId]: value,
      },
    }));
  }

  const missingRequiredCount = useMemo(() => {
    let missing = 0;
    for (const idea of selectedIdeas) {
      const qs = questionsByIdeaId[idea.id] ?? [];
      const answers = answersByIdeaId[idea.id] ?? {};
      if (qs.length === 0) continue;
      for (const q of qs) {
        if (!q.required) continue;
        const v = answers[q.id] ?? "";
        if (!v.trim()) {
          missing += 1;
          break;
        }
      }
    }
    return missing;
  }, [answersByIdeaId, questionsByIdeaId, selectedIdeas]);

  async function applySelectedIdeas() {
    if (selectedIdeas.length === 0) return;
    if (missingRequiredCount > 0) return;
    setApplying(true);
    setError(null);
    try {
      const payload = selectedIdeas.map((idea) => ({
        idea,
        answers: answersByIdeaId[idea.id] ?? {},
      }));
      const res = await fetch("/api/ai/scope-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode: "apply_idea",
          selectedIdeas: payload,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to apply selected ideas.");
        return;
      }
      setSelectedIdeaIds(new Set());
      setQuestionsByIdeaId({});
      setAnswersByIdeaId({});
      onApplied?.();
    } catch {
      setError("Network error while applying ideas.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-slate-900 text-base">Gallery finishes</CardTitle>
            <CardDescription className="text-slate-600">
              Browse visual scope ideas and add them as quick scope bubbles.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void loadIdeas();
            }}
            disabled={loadingIdeas}
            className="gap-1.5"
          >
            <ImageIcon className="size-3.5" />
            {loadingIdeas ? "Loading..." : ideas.length > 0 ? "Refresh gallery" : "See gallery finishes"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {ideas.length === 0 && !loadingIdeas ? (
          <p className="text-xs text-slate-500">
            Press <span className="font-medium">See gallery finishes</span> to generate image-based scope starters.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ideas.map((idea) => {
              const selected = selectedIdeaIds.has(idea.id);
              return (
                <button
                  key={idea.id}
                  onClick={() => toggleIdea(idea.id)}
                  className={`text-left rounded-lg border overflow-hidden transition-colors ${
                    selected
                      ? "border-slate-900 ring-1 ring-slate-900"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="relative h-28 bg-slate-100">
                    <img
                      src={idea.imageUrl}
                      alt={idea.title}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src =
                          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480'><rect width='100%' height='100%' fill='%23e2e8f0'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2364758b' font-size='20'>Image unavailable</text></svg>";
                      }}
                    />
                    {selected && (
                      <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-slate-900 text-white text-[10px] px-2 py-0.5">
                        <Check className="size-2.5" />
                        Selected
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 space-y-1.5">
                    <p className="text-sm font-medium text-slate-800 line-clamp-1">{idea.title}</p>
                    <p className="text-xs text-slate-500 line-clamp-2">{idea.caption}</p>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{idea.suggestedSegment}</Badge>
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        {Math.round((idea.confidence ?? 0.6) * 100)}%
                      </Badge>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedIdeas.length > 0 && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap gap-1.5">
              {selectedIdeas.map((i) => (
                <Badge key={i.id} variant="outline" className="bg-white text-xs">
                  <Sparkles className="size-2.5 mr-1" />
                  {i.title}
                </Badge>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void fetchDetailQuestions();
                }}
                disabled={loadingDetails}
              >
                {loadingDetails ? "Loading details..." : "Ask detail questions"}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void applySelectedIdeas();
                }}
                disabled={applying || missingRequiredCount > 0}
                className="gap-1.5"
              >
                <Plus className="size-3.5" />
                {applying ? "Adding..." : "Add selected to scope"}
              </Button>
            </div>

            {selectedIdeas.map((idea) => {
              const questions = questionsByIdeaId[idea.id] ?? [];
              if (questions.length === 0) return null;
              return (
                <div key={`questions-${idea.id}`} className="space-y-2 rounded-md border border-slate-200 bg-white p-2.5">
                  <p className="text-xs font-medium text-slate-700">{idea.title} · detail questions</p>
                  {questions.map((q) => (
                    <div key={q.id} className="space-y-1">
                      <p className="text-[11px] text-slate-600">
                        {q.question}
                        {q.required && <span className="text-rose-500"> *</span>}
                      </p>
                      <Input
                        value={answersByIdeaId[idea.id]?.[q.id] ?? ""}
                        onChange={(e) => updateAnswer(idea.id, q.id, e.target.value)}
                        placeholder={q.placeholder ?? "Type details..."}
                        className="h-8 bg-white"
                      />
                    </div>
                  ))}
                </div>
              );
            })}

            {missingRequiredCount > 0 && (
              <p className="text-xs text-amber-600">
                Fill required detail for each selected idea before adding to scope.
              </p>
            )}
          </div>
        )}

        {scopeItems.length > 0 && (
          <p className="text-[11px] text-slate-400">
            Existing scope items: {scopeItems.length}. Duplicate ideas are auto-filtered when applied.
          </p>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
