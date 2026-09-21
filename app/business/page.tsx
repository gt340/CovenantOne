"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Category = { slug: string; label: string };
type Business = {
  id: string;
  ownerId: string;
  businessName: string;
  categorySlug: string | null;
  description: string | null;
  website: string | null;
  openToPartnership: boolean;
  partnershipNotes?: string | null;
};

export default function BusinessPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [mine, setMine] = useState<Business | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [partnershipOnly, setPartnershipOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    if (partnershipOnly) params.set("partnership", "true");
    const [catRes, allRes, mineRes] = await Promise.all([
      fetch("/api/business-categories", { credentials: "include" }),
      fetch(`/api/business-profiles?${params.toString()}`, { credentials: "include" }),
      fetch("/api/business-profiles?mine=true", { credentials: "include" }),
    ]);
    if (catRes.ok) setCategories((await catRes.json()).categories ?? []);
    if (allRes.ok) setBusinesses((await allRes.json()).businesses ?? []);
    if (mineRes.ok) {
      const mineList = (await mineRes.json()).businesses ?? [];
      setMine(mineList[0] ?? null);
    }
    setLoading(false);
  }, [activeCategory, partnershipOnly]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Business Directory</h1>
      <p className="text-sm text-gray-500 mb-4">Businesses run by members of the community.</p>

      <div className="flex gap-2 flex-wrap mb-2">
        <button
          onClick={() => setActiveCategory(null)}
          className={`text-xs px-3 py-1.5 rounded-full border ${!activeCategory ? "bg-blue-600 text-white" : ""}`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.slug}
            onClick={() => setActiveCategory(c.slug)}
            className={`text-xs px-3 py-1.5 rounded-full border ${activeCategory === c.slug ? "bg-blue-600 text-white" : ""}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs mb-4">
        <input type="checkbox" checked={partnershipOnly} onChange={(e) => setPartnershipOnly(e.target.checked)} />
        Open to partnership only
      </label>

      <button onClick={() => setShowForm((s) => !s)} className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white mb-6">
        {showForm ? "Cancel" : mine ? "Edit My Listing" : "+ List My Business"}
      </button>

      {showForm && <BusinessForm categories={categories} existing={mine} onSaved={() => { setShowForm(false); load(); }} />}

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      <div className="space-y-2">
        {!loading && businesses.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">No businesses listed yet.</div>}
        {businesses.map((b) => (
          <Link key={b.id} href={`/business/${b.id}`} className="block border rounded-md p-3 hover:bg-gray-50">
            <div className="text-sm font-medium">{b.businessName}</div>
            <div className="text-xs text-gray-500">
              {categories.find((c) => c.slug === b.categorySlug)?.label ?? "Uncategorized"}
              {b.openToPartnership && <span className="ml-2 text-amber-600">· Open to partnership</span>}
            </div>
            {b.description && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{b.description}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}

function BusinessForm({ categories, existing, onSaved }: { categories: Category[]; existing: Business | null; onSaved: () => void }) {
  const [businessName, setBusinessName] = useState(existing?.businessName ?? "");
  const [categorySlug, setCategorySlug] = useState(existing?.categorySlug ?? categories[0]?.slug ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [openToPartnership, setOpenToPartnership] = useState(existing?.openToPartnership ?? false);
  const [partnershipNotes, setPartnershipNotes] = useState(existing?.partnershipNotes ?? "");
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
          categorySlug: categorySlug || undefined,
          description: description.trim() || undefined,
          website: website.trim() || undefined,
          openToPartnership,
          partnershipNotes: openToPartnership ? partnershipNotes.trim() || undefined : undefined,
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
      <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
        {categories.map((c) => (
          <option key={c.slug} value={c.slug}>{c.label}</option>
        ))}
      </select>
      <input type="text" placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full border rounded-md px-3 py-2 text-sm" />
      <input type="text" placeholder="Website (optional)" value={website} onChange={(e) => setWebsite(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={openToPartnership} onChange={(e) => setOpenToPartnership(e.target.checked)} />
        Open to partnership opportunities
      </label>
      {openToPartnership && (
        <textarea
          placeholder="What kind of partnership are you looking for?"
          value={partnershipNotes}
          onChange={(e) => setPartnershipNotes(e.target.value)}
          rows={2}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
      )}
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
        {saving ? "Saving..." : "Save Listing"}
      </button>
    </div>
  );
                                 }
