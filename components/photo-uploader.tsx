"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import type { Photo } from "@prisma/client";

const ROOM_LABELS = [
  "Kitchen", "Bathroom", "Living Room", "Bedroom",
  "Basement", "Hallway", "Laundry", "Exterior", "Other",
];

export function PhotoUploader({ projectId, photos }: { projectId: string; photos: Photo[] }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [localPhotos, setLocalPhotos] = useState(photos);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.querySelector('input[type="file"]') as HTMLInputElement;
    if (!input?.files?.length) return;

    setUploading(true);
    const formData = new FormData();
    for (const file of Array.from(input.files)) {
      formData.append("files", file);
    }

    const res = await fetch(`/api/photos/upload?projectId=${projectId}`, {
      method: "POST",
      body: formData,
    });
    setUploading(false);
    if (res.ok) {
      router.refresh();
      input.value = "";
    }
  }

  async function updatePhoto(id: string, updates: { roomLabel?: string; userNotes?: string }) {
    const res = await fetch(`/api/photos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const updated = await res.json();
      setLocalPhotos((prev) => prev.map((p) => (p.id === id ? updated : p)));
    }
  }

  const displayPhotos = localPhotos.length > 0 ? localPhotos : photos;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex items-center gap-4">
        <input
          type="file"
          name="files"
          multiple
          accept="image/*"
          className="text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-200 file:text-slate-900 file:font-medium"
        />
        <Button type="submit" disabled={uploading} size="sm">
          {uploading ? "Uploading..." : "Upload"}
        </Button>
      </form>

      {displayPhotos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayPhotos.map((p) => (
            <Card key={p.id} className="border-slate-200 overflow-hidden shadow-sm">
              <CardContent className="p-0">
                <img
                  src={p.url}
                  alt={p.roomLabel ?? "Photo"}
                  className="w-full aspect-video object-cover"
                />
                <div className="p-3 space-y-2">
                  <select
                    value={p.roomLabel ?? ""}
                    onChange={(e) => updatePhoto(p.id, { roomLabel: e.target.value })}
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">Select room</option>
                    {ROOM_LABELS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <Textarea
                    placeholder="What's in this photo? e.g. damaged vinyl near island"
                    defaultValue={(p as Photo & { userNotes?: string | null }).userNotes ?? ""}
                    onBlur={(e) => updatePhoto(p.id, { userNotes: e.target.value })}
                    rows={2}
                    className="bg-white border-slate-300 text-sm"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
