"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type ProjectEditFormProps = {
  projectId: string;
  provinces: string[];
  initialData: {
    address: string;
    province: string;
    sqft: string;
    propertyType?: string | null;
    neighborhoodTier?: string | null;
    addressDetails?: string | null;
    workTypes?: string | null;
    rooms?: string | null;
    materialGrade?: string | null;
    notes?: string | null;
    jobPrompt?: string | null;
  };
};

export function ProjectEditForm({ projectId, provinces, initialData }: ProjectEditFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [address, setAddress] = useState(initialData.address);
  const [addressDetails, setAddressDetails] = useState(initialData.addressDetails ?? "");
  const [editProvince, setEditProvince] = useState(initialData.province);
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

  const [workTypes, setWorkTypes] = useState<Set<string>>(
    new Set(initialData.workTypes?.split(",").filter(Boolean) ?? [])
  );
  const [rooms, setRooms] = useState<Set<string>>(
    new Set(initialData.rooms?.split(",").filter(Boolean) ?? [])
  );
  const [materialGrade, setMaterialGrade] = useState(initialData.materialGrade ?? "mid_range");

  function toggleSet(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: address,
        province: editProvince,
        sqft: formData.get("sqft"),
        propertyType: formData.get("propertyType") || null,
        neighborhoodTier: formData.get("neighborhoodTier") || null,
        addressDetails: addressDetails || null,
        workTypes: [...workTypes].join(",") || null,
        rooms: [...rooms].join(",") || null,
        materialGrade: materialGrade || null,
        jobPrompt: formData.get("jobPrompt") || null,
        notes: formData.get("notes") || null,
      }),
    });
    setLoading(false);
    if (res.ok) {
      router.push(`/projects/${projectId}`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-6">
        {/* Property */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900">Property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-700">Address</Label>
              <AddressAutocomplete
                value={address}
                onChange={(val) => { setAddress(val); setGeoStatus("idle"); }}
                onSelect={(sel: AddressSelection) => {
                  setAddress(sel.formatted);
                  setAddressDetails(sel.formatted);
                  if (sel.province) setEditProvince(sel.province);
                  setGeoStatus("found");
                  setGeoLabel(`Location found (${sel.lat.toFixed(4)}, ${sel.lng.toFixed(4)})`);
                }}
                placeholder="Start typing an address..."
                className="bg-white border-slate-300"
              />
              {geoStatus === "idle" && (
                <p className="text-xs text-slate-500">Type to search — pick a suggestion for accurate map location</p>
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
                <Label className="text-slate-700">Province</Label>
                <select
                  value={editProvince}
                  onChange={(e) => setEditProvince(e.target.value)}
                  required
                  className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select</option>
                  {provinces.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Square feet</Label>
                <Input name="sqft" defaultValue={initialData.sqft} required className="bg-white border-slate-300" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700">Property type</Label>
                <Input name="propertyType" defaultValue={initialData.propertyType ?? ""} className="bg-white border-slate-300" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Neighborhood</Label>
                <select
                  name="neighborhoodTier"
                  defaultValue={initialData.neighborhoodTier ?? ""}
                  className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select</option>
                  <option value="low_end">Lower end</option>
                  <option value="decent">Decent</option>
                  <option value="upscale">Upscale</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Job details */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900">Job Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-700">Work types</Label>
              <div className="flex flex-wrap gap-2">
                {WORK_TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
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
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-700">Rooms</Label>
              <div className="flex flex-wrap gap-2">
                {ROOM_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
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
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-700">Material grade</Label>
              <div className="flex gap-2">
                {[
                  { value: "budget", label: "Budget" },
                  { value: "mid_range", label: "Mid-range" },
                  { value: "premium", label: "Premium" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`px-4 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                      materialGrade === opt.value
                        ? "border-slate-900 bg-slate-50 text-slate-900"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="materialGradeRadio"
                      checked={materialGrade === opt.value}
                      onChange={() => setMaterialGrade(opt.value)}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Description */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900">Description</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-700">Job description</Label>
              <Textarea
                name="jobPrompt"
                defaultValue={initialData.jobPrompt ?? ""}
                rows={5}
                placeholder="Describe the work in detail..."
                className="bg-white border-slate-300"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-700">Notes</Label>
              <Textarea
                name="notes"
                defaultValue={initialData.notes ?? ""}
                rows={2}
                placeholder="Additional context..."
                className="bg-white border-slate-300"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
