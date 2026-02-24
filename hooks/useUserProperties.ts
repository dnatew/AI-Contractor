"use client";

import { useState, useEffect, useCallback } from "react";

export type UserProperty = {
  id: string;
  description: string;
  purchasePrice: number;
  purchaseDate: string;
  salePrice: number;
  saleDate: string;
  sqft: number;
  features: Set<string>;
  renoWork: string;
  notes: string;
};

type DBProperty = {
  id: string;
  description: string;
  purchasePrice: number;
  purchaseDate: string | null;
  salePrice: number;
  saleDate: string | null;
  sqft: number;
  features: string;
  renoWork: string | null;
  notes: string | null;
};

function fromDB(p: DBProperty): UserProperty {
  return {
    id: p.id,
    description: p.description,
    purchasePrice: p.purchasePrice,
    purchaseDate: p.purchaseDate ?? "",
    salePrice: p.salePrice,
    saleDate: p.saleDate ?? "",
    sqft: p.sqft,
    features: new Set(p.features ? p.features.split(",").filter(Boolean) : []),
    renoWork: p.renoWork ?? "",
    notes: p.notes ?? "",
  };
}

function toDB(p: UserProperty) {
  return {
    id: p.id,
    description: p.description,
    purchasePrice: p.purchasePrice,
    purchaseDate: p.purchaseDate || null,
    salePrice: p.salePrice,
    saleDate: p.saleDate || null,
    sqft: p.sqft,
    features: [...p.features].join(","),
    renoWork: p.renoWork || null,
    notes: p.notes || null,
  };
}

export function useUserProperties() {
  const [properties, setProperties] = useState<UserProperty[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/user-properties")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DBProperty[]) => {
        setProperties(data.map(fromDB));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const addProperty = useCallback(async () => {
    const res = await fetch("/api/user-properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "" }),
    });
    if (!res.ok) return null;
    const data: DBProperty = await res.json();
    const prop = fromDB(data);
    setProperties((prev) => [prop, ...prev]);
    return prop;
  }, []);

  const updateProperty = useCallback(async (id: string, updates: Partial<Omit<UserProperty, "id" | "features">>) => {
    setProperties((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
    await fetch("/api/user-properties", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
  }, []);

  const toggleFeature = useCallback(async (id: string, featureKey: string) => {
    let newFeatures = "";
    setProperties((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = new Set(p.features);
        if (next.has(featureKey)) next.delete(featureKey);
        else next.add(featureKey);
        newFeatures = [...next].join(",");
        return { ...p, features: next };
      })
    );
    await fetch("/api/user-properties", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, features: newFeatures }),
    });
  }, []);

  const removeProperty = useCallback(async (id: string) => {
    setProperties((prev) => prev.filter((p) => p.id !== id));
    await fetch(`/api/user-properties?id=${id}`, { method: "DELETE" });
  }, []);

  const saveProperty = useCallback(async (prop: UserProperty) => {
    const payload = toDB(prop);
    await fetch("/api/user-properties", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, []);

  return {
    properties,
    loaded,
    addProperty,
    updateProperty,
    toggleFeature,
    removeProperty,
    saveProperty,
  };
}
