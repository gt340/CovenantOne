"use client";

import { useState, useEffect, useCallback } from "react";

type Job = {
  id: string;
  posterId: string;
  title: string;
  company: string | null;
  description: string;
  location: string | null;
  isRemote: boolean;
  createdAt: string;
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPost, setShowPost] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/jobs", { credentials: "include" });
    if (res.ok) setJobs((await res.json()).jobs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Jobs</h1>
      <p className="text-sm text-gray-500 mb-6">Opportunities shared within the community.</p>

      <button onClick={() => setShowPost((s) => !s)} className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white mb-6">
        {showPost ? "Cancel" : "+ Post a Job"}
      </button>

      {showPost && <PostJobForm onPosted={() => { setShowPost(false); load(); }} />}

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      <div className="space-y-2">
        {!loading && jobs.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">No jobs posted yet.</div>}
        {jobs.map((j) => (
          <div key={j.id} className="border rounded-md p-3">
            <div className="text-sm font-medium">{j.title}</div>
            <div className="text-xs text-gray-500 mb-1">
              {j.company ?? "Independent"} · {j.isRemote ? "Remote" : j.location ?? "Location TBD"}
            </div>
            <p className="text-xs text-gray-600">{j.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PostJobForm({ onPosted }: { onPosted: () => void }) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [isRemote, setIsRemote] = useState(false);
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
