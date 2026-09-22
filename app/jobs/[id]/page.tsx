"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function publicImageUrl(key: string | null) {
  if (!key) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/listing-images/${key}`;
}

type JobDetail = {
  id: string;
  posterId: string;
  title: string;
  company: string | null;
  description: string;
  location: string | null;
  isRemote: boolean;
  isRemoved: boolean;
  bannerImageKey: string | null;
  business: { businessName: string; category: string | null; description: string | null; website: string | null } | null;
  myApplication: { id: string; status: string } | null;
};
type Application = { id: string; applicantId: string; applicantName: string; coverNote: string | null; status: string; createdAt: string };

export default function JobDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [coverNote, setCoverNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/jobs/${id}`, { credentials: "include" });
    if (res.ok) setJob(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCurrentUserId(d?.id ?? null));
  }, []);

  useEffect(() => {
    if (job && currentUserId && job.posterId === currentUserId) {
      fetch(`/api/jobs/${id}/apply`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { applications: [] }))
        .then((d) => setApplications(d.applications ?? []));
    }
  }, [job, currentUserId, id]);

  async function apply() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${id}/apply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverNote: coverNote.trim() || undefined }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply.");
    } finally {
      setApplying(false);
    }
  }

  async function updateApplicationStatus(appId: string, status: string) {
    const res = await fetch(`/api/job-applications/${appId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const res2 = await fetch(`/api/jobs/${id}/apply`, { credentials: "include" });
      if (res2.ok) setApplications((await res2.json()).applications ?? []);
    }
  }

  async function uploadBanner(file: File) {
    if (!currentUserId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${currentUserId}/${id}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("listing-images").upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerImageKey: path }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload image.");
    } finally {
      setUploading(false);
    }
  }

  if (loading || currentUserId === null) return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-400">Loading...</div>;
  if (!job) return <div className="max-w-2xl mx-auto px-4 py-8">Job not found.</div>;

  const isPoster = job.posterId === currentUserId;
  const bannerUrl = publicImageUrl(job.bannerImageKey);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/jobs" className="text-sm text-blue-600 mb-3 inline-block">← Back to Jobs</Link>

      {bannerUrl && (
        <img src={bannerUrl} alt={job.title} className="w-full h-40 object-cover rounded-md mb-3" />
      )}

      <h1 className="text-xl font-semibold">{job.title}</h1>
      <div className="text-xs text-gray-500 mb-3">
        {job.business?.businessName ?? job.company ?? "Independent"} · {job.isRemote ? "Remote" : job.location ?? "Location TBD"}
      </div>
      <p className="text-sm whitespace-pre-wrap mb-4">{job.description}</p>

      {job.business && (
        <div className="border rounded-md p-3 mb-4 bg-gray-50">
          <div className="text-xs font-medium mb-1">About the employer</div>
          <div className="text-sm font-medium">{job.business.businessName}</div>
          {job.business.description && <p className="text-xs text-gray-600">{job.business.description}</p>}
          {job.business.website && (
            <a href={job.business.website} target="_blank" rel="noreferrer" className="text-xs text-blue-600">
              {job.business.website}
            </a>
          )}
        </div>
      )}

      {isPoster && (
        <div className="border rounded-md p-3 mb-4">
          <div className="text-xs font-medium mb-2">{bannerUrl ? "Change" : "Add"} banner image</div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadBanner(file);
            }}
            className="text-xs"
          />
          {uploading && <div className="text-xs text-gray-400 mt-1">Uploading...</div>}
          {uploadError && <div className="text-red-600 text-xs mt-1">{uploadError}</div>}
        </div>
      )}

      {!isPoster && (
        <div className="border rounded-md p-3 mb-6">
          {job.myApplication ? (
            <div className="text-sm">You applied — status: <span className="font-medium">{job.myApplication.status}</span></div>
          ) : (
            <>
              <textarea
                placeholder="Short cover note (optional)"
                value={coverNote}
                onChange={(e) => setCoverNote(e.target.value)}
                rows={3}
                className="w-full border rounded-md px-3 py-2 text-sm mb-2"
              />
              {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
              <button onClick={apply} disabled={applying} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
                {applying ? "Applying..." : "Apply"}
              </button>
            </>
          )}
        </div>
      )}

      {isPoster && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-2">Applicants ({applications?.length ?? 0})</h2>
          <div className="space-y-2">
            {(applications ?? []).map((a) => (
              <div key={a.id} className="border rounded-md p-3">
                <div className="text-sm font-medium">{a.applicantName}</div>
                <div className="text-xs text-gray-500 mb-1">{a.status}</div>
                {a.coverNote && <p className="text-xs text-gray-600 mb-2">{a.coverNote}</p>}
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => updateApplicationStatus(a.id, "SHORTLISTED")} className="text-xs px-2 py-1 rounded-md border">Shortlist</button>
                  <button onClick={() => updateApplicationStatus(a.id, "REVIEWED")} className="text-xs px-2 py-1 rounded-md border">Mark Reviewed</button>
                  <button onClick={() => updateApplicationStatus(a.id, "REJECTED")} className="text-xs px-2 py-1 rounded-md border text-red-600">Reject</button>
                </div>
              </div>
            ))}
            {applications?.length === 0 && <div className="text-xs text-gray-400">No applicants yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
    }
