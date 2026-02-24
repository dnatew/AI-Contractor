"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { MapPin } from "lucide-react";

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
};

export type AddressSelection = {
  formatted: string;
  city: string;
  province: string;
  postcode: string;
  lat: number;
  lng: number;
};

const PROVINCE_MAP: Record<string, string> = {
  Ontario: "ON", Quebec: "QC", "British Columbia": "BC", Alberta: "AB",
  Manitoba: "MB", Saskatchewan: "SK", "Nova Scotia": "NS", "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL", "Prince Edward Island": "PE",
  "Northwest Territories": "NT", Nunavut: "NU", Yukon: "YT",
};

function formatAddress(props: PhotonFeature["properties"]): string {
  const parts: string[] = [];
  if (props.housenumber && props.street) {
    parts.push(`${props.housenumber} ${props.street}`);
  } else if (props.street) {
    parts.push(props.street);
  } else if (props.name) {
    parts.push(props.name);
  }
  if (props.city) parts.push(props.city);
  if (props.state) parts.push(PROVINCE_MAP[props.state] ?? props.state);
  if (props.postcode) parts.push(props.postcode);
  return parts.join(", ");
}

function resolveProvince(state?: string): string {
  if (!state) return "";
  return PROVINCE_MAP[state] ?? state;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSelect: (selection: AddressSelection) => void;
  placeholder?: string;
  className?: string;
};

export function AddressAutocomplete({ value, onChange, onSelect, placeholder, className }: Props) {
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressRef = useRef(false);

  const search = useCallback(async (query: string) => {
    if (query.length < 2) { setSuggestions([]); setOpen(false); return; }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(`/api/address-search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      if (!res.ok || controller.signal.aborted) return;
      const data = await res.json() as { features: PhotonFeature[] };
      if (controller.signal.aborted) return;

      setSuggestions(data.features ?? []);
      setOpen((data.features ?? []).length > 0);
      setActiveIndex(-1);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  function handleChange(text: string) {
    onChange(text);
    suppressRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!suppressRef.current) search(text);
    }, 150);
  }

  function handleSelect(feature: PhotonFeature) {
    suppressRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const formatted = formatAddress(feature.properties);
    const [lng, lat] = feature.geometry.coordinates;
    onChange(formatted);
    setSuggestions([]);
    setOpen(false);
    setLoading(false);
    onSelect({
      formatted,
      city: feature.properties.city ?? "",
      province: resolveProvince(feature.properties.state),
      postcode: feature.properties.postcode ?? "",
      lat,
      lng,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : suggestions.length - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
        <Input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          placeholder={placeholder ?? "Start typing an address..."}
          className={`pl-8 ${className ?? ""}`}
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map((feature, i) => {
            const p = feature.properties;
            const main = p.housenumber && p.street
              ? `${p.housenumber} ${p.street}`
              : p.street ?? p.name ?? "";
            const sub = [p.city, resolveProvince(p.state), p.postcode].filter(Boolean).join(", ");

            return (
              <li
                key={i}
                className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer text-sm transition-colors ${
                  i === activeIndex ? "bg-slate-100" : "hover:bg-slate-50"
                }`}
                onMouseDown={() => handleSelect(feature)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <MapPin className="size-3.5 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-slate-900 font-medium truncate">{main}</p>
                  {sub && <p className="text-slate-500 text-xs truncate">{sub}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
