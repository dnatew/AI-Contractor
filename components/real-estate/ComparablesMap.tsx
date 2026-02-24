"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPin = {
  lat: number;
  lng: number;
  label: string;
  type: "project" | "comparable";
  price?: number;
  sqft?: number;
  notes?: string;
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

const PROJECT_ICON = L.divIcon({
  className: "",
  html: `<div style="background:#059669;color:white;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">★</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -18],
});

function compIcon(index: number) {
  return L.divIcon({
    className: "",
    html: `<div style="background:#3b82f6;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25);">${index + 1}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

export function ComparablesMap({ pins }: { pins: MapPin[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || pins.length === 0) return;

    if (leafletMap.current) {
      leafletMap.current.remove();
      leafletMap.current = null;
    }

    const map = L.map(mapRef.current, { scrollWheelZoom: false });
    leafletMap.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    let compIndex = 0;

    for (const pin of pins) {
      const icon = pin.type === "project" ? PROJECT_ICON : compIcon(compIndex);
      if (pin.type === "comparable") compIndex++;

      const popupLines = [`<strong>${pin.label}</strong>`];
      if (pin.price) popupLines.push(`<span style="color:#059669;font-weight:600;">${formatCurrency(pin.price)}</span>`);
      if (pin.sqft) popupLines.push(`<span style="font-size:12px;color:#64748b;">${pin.sqft} sqft</span>`);
      if (pin.notes) popupLines.push(`<span style="font-size:12px;color:#64748b;">${pin.notes}</span>`);
      if (pin.type === "project") popupLines.unshift('<span style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#059669;">Your project</span>');

      L.marker([pin.lat, pin.lng], { icon })
        .addTo(map)
        .bindPopup(popupLines.join("<br/>"));

      bounds.extend([pin.lat, pin.lng]);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }

    return () => {
      map.remove();
      leafletMap.current = null;
    };
  }, [pins]);

  if (pins.length === 0) return null;

  return (
    <div className="rounded-lg overflow-hidden border border-slate-200 shadow-sm">
      <div ref={mapRef} style={{ height: 350, width: "100%" }} />
      <div className="flex flex-wrap gap-4 px-3 py-2 bg-slate-50 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-emerald-600" />
          Your property
        </span>
        {pins.some((p) => p.type === "comparable") && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-blue-500" />
            Comparables
          </span>
        )}
      </div>
    </div>
  );
}
