"use client";

import dynamic from "next/dynamic";
import type { MapPin } from "./ComparablesMap";

const ComparablesMap = dynamic(
  () => import("./ComparablesMap").then((mod) => mod.ComparablesMap),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center" style={{ height: 350 }}>
        <p className="text-sm text-slate-400 animate-pulse">Loading map...</p>
      </div>
    ),
  }
);

export function DynamicComparablesMap({ pins }: { pins: MapPin[] }) {
  if (!pins.length) return null;
  return <ComparablesMap pins={pins} />;
}
