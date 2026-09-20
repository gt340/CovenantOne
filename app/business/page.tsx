"use client";

import { useState, useEffect, useCallback } from "react";

type Business = {
  id: string;
  ownerId: string;
  businessName: string;
  category: string | null;
  description: string | null;
  website: string | null;
};

export default function BusinessPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [mine, setMine] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [allRes, mineRes] = await Promise.all([
      fetch("/api/business-profiles", { credentials: "include" }),
      fetch("/api/business-profiles?mine=true", { credentials: "include" }),
    ]);
    if (allRes.ok) setBusinesses((await allRes.json()).businesses ?? []);
    if (mineRes.ok) {
      const mineList = (await mineRes.json()).businesses ?? [];
      setMine(mineList[0] ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Business Directory</h1>
      <p className="text-sm text-gray-500 mb-6">Businesses run by members of the community.</p>

      <button onClick={() => setShowForm((s) => !s)} className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white mb-6">
        {showForm ? "Cancel" : mine ? "Edit My Listing" : "+ List My Business"}
      </button>

      {showForm && <BusinessForm existing={mine} onSaved={() => { setShowForm(false); load(); }} />}

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      <div className="space-y-2">
        {!loading && businesses.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">No businesses listed yet.</div>}
        {businesses.map((b) => (
          <div key={b.id} className="border rounded-md p-3">
            <div className="text-sm font-medium">{b.businessName}</div>
            {b.category && <div className="text-xs text-gray-500 mb-1">{b.category}</div>}
            {b.description && <p className="text-xs text-gray-600 mb-1">{b.description}</p>}
            {b.website && (
              <a href={b.website} target="_blank" rel="noreferrer" className="text-xs text-blue-600">
                {b.website}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BusinessForm({ existing, onSaved }: { existing: Business | null; onSaved: () => void }) {
  const [businessName, setBusinessName] = useState(existing?.businessName ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!businessName.trim()) {
      setError("Business name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/business-profiles", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          category: category.trim() || undefined,
          description: description.trim() || undefined,
          website: website.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save listing.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-md p-3 mb-6 space-y-2">
      <input type="text" placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <input type="text" placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full border rounded-md px-3 py-2 text-sm" />
      <input type="text" placeholder="Website (optional)" value={website} onChange={(e) => setWebsite(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
        {saving ? "Saving..." : "Save Listing"}
      </button>
    </div>
  );
}
