"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressAutocomplete, type AddressSelection } from "@/components/address-autocomplete";

const WORK_TYPE_OPTIONS = [
  { value: "flooring", label: "Flooring" },
  { value: "kitchen", label: "Kitchen reno" },
  { value: "bathroom", label: "Bathroom reno" },
  { value: "painting", label: "Painting" },
  { value: "drywall", label: "Drywall" },
  { value: "tiling", label: "Tiling" },
  { value: "baseboard_trim", label: "Baseboard / Trim" },
  { value: "demolition", label: "Demolition" },
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "other", label: "Other" },
];

const ROOM_OPTIONS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "living_room", label: "Living Room" },
  { value: "bedroom", label: "Bedroom" },
  { value: "basement", label: "Basement" },
  { value: "hallway", label: "Hallway" },
  { value: "laundry", label: "Laundry" },
  { value: "whole_house", label: "Whole house" },
  { value: "other", label: "Other" },
];

type ProjectFormProps = {
  provinces: string[];
  initialData?: {
    address: string;
    province: string;
    sqft: string;
    propertyType?: string;
    neighborhoodTier?: string;
    addressDetails?: string;
    workTypes?: string;
    rooms?: string;
    materialGrade?: string;
    notes?: string;
    jobPrompt?: string;
  };
};

export function ProjectForm({ provinces, initialData }: ProjectFormProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [address, setAddress] = useState(initialData?.address ?? "");
  const [addressDetails, setAddressDetails] = useState(initialData?.addressDetails ?? "");
  const [province, setProvince] = useState(initialData?.province ?? "");
  const [sqft, setSqft] = useState(initialData?.sqft ?? "");
  const [propertyType, setPropertyType] = useState(initialData?.propertyType ?? "");
  const [neighborhoodTier, setNeighborhoodTier] = useState(initialData?.neighborhoodTier ?? "");

  const [workTypes, setWorkTypes] = useState<Set<string>>(
    new Set(initialData?.workTypes?.split(",").filter(Boolean) ?? [])
  );
  const [rooms, setRooms] = useState<Set<string>>(
    new Set(initialData?.rooms?.split(",").filter(Boolean) ?? [])
  );
  const [materialGrade, setMaterialGrade] = useState(initialData?.materialGrade ?? "mid_range");

  const [jobPrompt, setJobPrompt] = useState(initialData?.jobPrompt ?? "");
  const [notes, setNotes] = useState(initialData?.notes ?? "");

  const [geoStatus, setGeoStatus] = useState<"idle" | "checking" | "found" | "not_found">("idle");
  const [geoLabel, setGeoLabel] = useState("");
  const geoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkAddress = useCallback((addr: string, prov: string) => {
    if (geoTimer.current) clearTimeout(geoTimer.current);
    if (!addr.trim()) { setGeoStatus("idle"); return; }
    setGeoStatus("checking");
    geoTimer.current = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ address: addr.trim(), ...(prov ? { province: prov } : {}) });
        const res = await fetch(`/api/geocode?${q}`);
        const data = await res.json();
        if (data.found) {
          setGeoStatus("found");
          setGeoLabel(`Location found (${data.lat.toFixed(4)}, ${data.lng.toFixed(4)})`);
        } else {
          setGeoStatus("not_found");
          setGeoLabel("Could not locate — try a more specific address");
        }
      } catch {
        setGeoStatus("not_found");
        setGeoLabel("Geocoding unavailable");
      }
    }, 800);
  }, []);

  function toggleSet(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function canAdvance(): boolean {
    if (step === 1) return address.trim().length > 0 && province.length > 0 && sqft.trim().length > 0;
    if (step === 2) return workTypes.size > 0 && rooms.size > 0;
    return true;
  }

  async function handleSubmit() {
    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: address.trim(),
        addressDetails: addressDetails.trim() || undefined,
        province,
        sqft: sqft.trim(),
        propertyType: propertyType.trim() || undefined,
        neighborhoodTier: neighborhoodTier || undefined,
        workTypes: [...workTypes].join(",") || undefined,
        rooms: [...rooms].join(",") || undefined,
        materialGrade: materialGrade || undefined,
        jobPrompt: jobPrompt.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    });
    setLoading(false);
    if (res.ok) {
      const project = await res.json();
      router.push(`/projects/${project.id}`);
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => s < step && setStep(s)}
              className={`size-8 rounded-full text-sm font-medium flex items-center justify-center transition-colors ${
                s === step
                  ? "bg-slate-900 text-white"
                  : s < step
                  ? "bg-slate-200 text-slate-700 cursor-pointer hover:bg-slate-300"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              {s}
            </button>
            <span className={`text-sm ${s === step ? "text-slate-900 font-medium" : "text-slate-500"}`}>
              {s === 1 ? "Property" : s === 2 ? "Job details" : "Description"}
            </span>
            {s < 3 && <div className="w-8 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      {/* Step 1: Property */}
      {step === 1 && (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900">Property info</CardTitle>
            <CardDescription className="text-slate-600">Where is the job?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-700">Address *</Label>
              <AddressAutocomplete
                value={address}
                onChange={(val) => { setAddress(val); setGeoStatus("idle"); }}
                onSelect={(sel: AddressSelection) => {
                  setAddress(sel.formatted);
                  setAddressDetails(sel.formatted);
                  if (sel.province) setProvince(sel.province);
                  setGeoStatus("found");
                  setGeoLabel(`Location found (${sel.lat.toFixed(4)}, ${sel.lng.toFixed(4)})`);
                }}
                placeholder="Start typing an address..."
                className="bg-white border-slate-300"
              />
              {geoStatus === "idle" && (
                <p className="text-xs text-slate-500">
                  Type to search — pick a suggestion for accurate map location and comparables
                </p>
              )}
              {geoStatus === "checking" && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="size-3 animate-spin rounded-full border border-slate-300 border-t-slate-600" />
                  Verifying address...
                </p>
              )}
              {geoStatus === "found" && (
                <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  {geoLabel}
                </p>
              )}
              {geoStatus === "not_found" && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {geoLabel}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700">Province *</Label>
                <select
                  value={province}
                  onChange={(e) => {
                    setProvince(e.target.value);
                    if (address.trim() && geoStatus !== "found") {
                      checkAddress(addressDetails || address, e.target.value);
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">Select</option>
                  {provinces.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Square feet *</Label>
                <Input
                  placeholder="1200"
                  value={sqft}
                  onChange={(e) => setSqft(e.target.value)}
                  className="bg-white border-slate-300"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700">Property type</Label>
                <Input
                  placeholder="Single family, Condo, etc."
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value)}
                  className="bg-white border-slate-300"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Neighborhood</Label>
                <select
                  value={neighborhoodTier}
                  onChange={(e) => setNeighborhoodTier(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">Select area type</option>
                  <option value="low_end">Lower end / budget area</option>
                  <option value="decent">Decent / middle-class area</option>
                  <option value="upscale">Upscale / higher-end area</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Job details */}
      {step === 2 && (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900">What kind of work?</CardTitle>
            <CardDescription className="text-slate-600">Select all that apply</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label className="text-slate-700">Work types *</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {WORK_TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      workTypes.has(opt.value)
                        ? "border-slate-900 bg-slate-50 text-slate-900"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={workTypes.has(opt.value)}
                      onChange={() => setWorkTypes(toggleSet(workTypes, opt.value))}
                      className="sr-only"
                    />
                    <div className={`size-4 rounded border flex items-center justify-center ${
                      workTypes.has(opt.value) ? "bg-slate-900 border-slate-900" : "border-slate-300"
                    }`}>
                      {workTypes.has(opt.value) && (
                        <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-slate-700">Rooms / areas involved *</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ROOM_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      rooms.has(opt.value)
                        ? "border-slate-900 bg-slate-50 text-slate-900"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={rooms.has(opt.value)}
                      onChange={() => setRooms(toggleSet(rooms, opt.value))}
                      className="sr-only"
                    />
                    <div className={`size-4 rounded border flex items-center justify-center ${
                      rooms.has(opt.value) ? "bg-slate-900 border-slate-900" : "border-slate-300"
                    }`}>
                      {rooms.has(opt.value) && (
                        <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-slate-700">Material grade</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "budget", label: "Budget", desc: "Basic materials" },
                  { value: "mid_range", label: "Mid-range", desc: "Standard quality" },
                  { value: "premium", label: "Premium", desc: "High-end finishes" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex flex-col items-center px-3 py-3 rounded-lg border cursor-pointer transition-colors text-center ${
                      materialGrade === opt.value
                        ? "border-slate-900 bg-slate-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="materialGrade"
                      checked={materialGrade === opt.value}
                      onChange={() => setMaterialGrade(opt.value)}
                      className="sr-only"
                    />
                    <span className={`text-sm font-medium ${materialGrade === opt.value ? "text-slate-900" : "text-slate-600"}`}>
                      {opt.label}
                    </span>
                    <span className="text-xs text-slate-500">{opt.desc}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Description */}
      {step === 3 && (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900">Describe the work</CardTitle>
            <CardDescription className="text-slate-600">
              The more detail you provide, the better the AI scope will be
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary of selections */}
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
              <p className="text-sm text-slate-900">
                <span className="text-slate-500">Property:</span> {address}, {province} - {sqft} sqft
              </p>
              <p className="text-sm text-slate-900">
                <span className="text-slate-500">Work:</span> {[...workTypes].map((w) => WORK_TYPE_OPTIONS.find((o) => o.value === w)?.label ?? w).join(", ")}
              </p>
              <p className="text-sm text-slate-900">
                <span className="text-slate-500">Rooms:</span> {[...rooms].map((r) => ROOM_OPTIONS.find((o) => o.value === r)?.label ?? r).join(", ")}
              </p>
              <p className="text-sm text-slate-900">
                <span className="text-slate-500">Material:</span> {materialGrade === "budget" ? "Budget" : materialGrade === "premium" ? "Premium" : "Mid-range"}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700">Job description</Label>
              <Textarea
                placeholder="Describe what you're doing. e.g. Rip out old vinyl plank in kitchen and living room, install new LVP throughout, new baseboard and transitions. Kitchen cabinets are staying but getting new countertops."
                value={jobPrompt}
                onChange={(e) => setJobPrompt(e.target.value)}
                rows={5}
                className="bg-white border-slate-300"
              />
              <p className="text-xs text-slate-500">
                Be specific: what's being removed, what's being installed, any special conditions.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700">Additional notes (optional)</Label>
              <Textarea
                placeholder="Anything else: access issues, timeline, special requests..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="bg-white border-slate-300"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(step - 1)}
          disabled={step === 1}
        >
          Back
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canAdvance()}>
            Next
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Creating project..." : "Create Project"}
          </Button>
        )}
      </div>
    </div>
  );
}
