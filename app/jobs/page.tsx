"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Category = { slug: string; label: string };
type Job = {
  id: string;
  title: string;
  employerName: string;
  location: string | null;
  isRemote: boolean;
  category: string | null;
  createdAt: string;
};

export default function JobsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showPost, setShowPost] = useState(false);

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/job-categories", { credentials: "include" });
    if (res.ok) setCategories((await res.json()).categories ?? []);
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/jobs?${params.toString()}`, { credentials: "include" });
    if (res.ok) setJobs((await res.json()).jobs ?? []);
    setLoading(false);
  }, [activeCategory, q]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);
  useEffect(() => {
    const t = setTimeout(loadJobs, 300); // debounce search
    return () => clearTimeout(t);
  }, [loadJobs]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Jobs</h1>
      <p className="text-sm text-gray-500 mb-4">Opportunities shared within the community.</p>

      <input
        type="text"
        placeholder="Search jobs..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm mb-3"
      />

      <div className="flex gap-2 flex-wrap mb-4">
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

      <button onClick={() => setShowPost((s) => !s)} className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white mb-6">
        {showPost ? "Cancel" : "+ Post a Job"}
      </button>

      {showPost && <PostJobForm categories={categories} onPosted={() => { setShowPost(false); loadJobs(); }} />}

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      <div className="space-y-2">
        {!loading && jobs.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">No jobs found.</div>}
        {jobs.map((j) => (
          <Link key={j.id} href={`/jobs/${j.id}`} className="block border rounded-md p-3 hover:bg-gray-50">
            <div className="text-sm font-medium">{j.title}</div>
            <div className="text-xs text-gray-500">
              {j.employerName} · {j.isRemote ? "Remote" : j.location ?? "Location TBD"}
              {j.category && ` · ${categories.find((c) => c.slug === j.category)?.label ?? j.category}`}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PostJobForm({ categories, onPosted }: { categories: Category[]; onPosted: () => void }) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [isRemote, setIsRemote] = useState(false);
  const [category, setCategory] = useState(categories[0]?.slug ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          company: company.trim() || undefined,
          description: description.trim(),
          location: location.trim() || undefined,
          isRemote,
          category: category || undefined,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post job.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-md p-3 mb-6 space-y-2">
      <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
        {categories.map((c) => (
          <option key={c.slug} value={c.slug}>{c.label}</option>
        ))}
      </select>
      <input type="text" placeholder="Job title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <input type="text" placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full border rounded-md px-3 py-2 text-sm" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isRemote} onChange={(e) => setIsRemote(e.target.checked)} />
        Remote
      </label>
      {!isRemote && (
        <input type="text" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      )}
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
        {saving ? "Posting..." : "Post Job"}
      </button>
    </div>
  );
                               }
