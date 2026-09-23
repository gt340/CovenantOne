"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Category = { slug: string; label: string; isEnabled: boolean };
type Report = {
  id: string;
  reporterName: string;
  reportedUserName: string;
  reportedUserId: string;
  category: string;
  description: string;
  relatedContentType: "JOB_LISTING" | "BUSINESS_PROFILE";
  relatedContentId: string;
  status: string;
  content: { title?: string; businessName?: string; isRemoved: boolean } | null;
};

type Tab = "reports" | "job-categories" | "business-categories";

export default function AdminPurposeProsperityPage() {
  const [tab, setTab] = useState<Tab>("reports");
  const [reports, setReports] = useState<Report[]>([]);
  const [jobCategories, setJobCategories] = useState<Category[]>([]);
  const [businessCategories, setBusinessCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "reports") {
        const res = await fetch("/api/admin/purpose-prosperity/reports", { credentials: "include" });
        if (res.ok) setReports((await res.json()).reports ?? []);
      } else if (tab === "job-categories") {
        const res = await fetch("/api/admin/job-categories", { credentials: "include" });
        if (res.ok) setJobCategories((await res.json()).categories ?? []);
      } else {
        const res = await fetch("/api/admin/business-categories", { credentials: "include" });
        if (res.ok) setBusinessCategories((await res.json()).categories ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleJobCategory(slug: string, isEnabled: boolean) {
    const res = await fetch(`/api/admin/job-categories/${slug}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled }),
    });
    if (res.ok) load();
    else setError("Could not update category");
  }

  async function toggleBusinessCategory(slug: string, isEnabled: boolean) {
    const res = await fetch(`/api/admin/business-categories/${slug}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled }),
    });
    if (res.ok) load();
    else setError("Could not update category");
  }

  async function removeContent(report: Report) {
    const path =
      report.relatedContentType === "JOB_LISTING"
        ? `/api/jobs/${report.relatedContentId}`
        : `/api/business-profiles/${report.relatedContentId}`;
    const res = await fetch(path, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRemoved: true, removedReason: "Reported and reviewed by admin" }),
    });
    if (res.ok) load();
    else {
      const b = await res.json().catch(() => null);
      setError(`Could not remove content: ${b?.error ?? res.status}`);
    }
  }

  async function suspendUser(userId: string) {
    const days = window.prompt("Suspend this account for how many days?", "7");
    if (!days) return;
    const res = await fetch("/api/admin/purpose-prosperity/suspend", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, days: Number(days) }),
    });
    if (res.ok) {
      alert("Account suspended.");
      load();
    } else {
      setError("Could not suspend account");
    }
  }

  async function dismissReport(id: string) {
    const res = await fetch(`/api/admin/purpose-prosperity/reports/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DISMISSED" }),
    });
    if (res.ok) load();
    else setError("Could not update report");
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Purpose & Prosperity Admin</h1>
        <Link href="/jobs" className="text-sm text-blue-600">
          View live →
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Reported content, job categories, and business categories.</p>

      <div className="flex gap-2 mb-6 flex-wrap">
        {(["reports", "job-categories", "business-categories"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-1.5 rounded-md border ${tab === t ? "bg-blue-600 text-white" : ""}`}
          >
            {t === "reports" ? "Reports" : t === "job-categories" ? "Job Categories" : "Business Categories"}
          </button>
        ))}
      </div>

      {error && <div className="text-red-600 text-xs mb-4">{error}</div>}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}

      {!loading && tab === "reports" && (
        <div className="space-y-2">
          {reports.length === 0 && <div className="text-xs text-gray-400">No reports.</div>}
          {reports.map((r) => (
            <div key={r.id} className="border rounded-md p-3">
              <div className="text-xs text-gray-500 mb-1">
                {r.reporterName} reported {r.reportedUserName}'s {r.relatedContentType === "JOB_LISTING" ? "job listing" : "business listing"} ·{" "}
                {r.category.replace(/_/g, " ")} · <span className="uppercase">{r.status}</span>
              </div>
              <p className="text-xs text-gray-600 mb-1">"{r.description}"</p>
              {r.content && (
                <div className="bg-gray-50 rounded-md p-2 text-xs mb-2">
                  <div className={r.content.isRemoved ? "line-through text-gray-400" : ""}>
                    {r.content.title ?? r.content.businessName}
                  </div>
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => removeContent(r)} className="text-xs px-2 py-1 rounded-md border text-red-600">
                  Remove listing
                </button>
                <button onClick={() => suspendUser(r.reportedUserId)} className="text-xs px-2 py-1 rounded-md border text-amber-700">
                  Suspend account
                </button>
                <button onClick={() => dismissReport(r.id)} className="text-xs px-2 py-1 rounded-md border">
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "job-categories" && (
        <div className="space-y-2">
          {jobCategories.map((c) => (
            <div key={c.slug} className="border rounded-md p-3 flex items-center justify-between">
              <div className="text-sm">{c.label}</div>
              <button
                onClick={() => toggleJobCategory(c.slug, !c.isEnabled)}
                className={`text-xs px-2 py-1 rounded-md border ${c.isEnabled ? "" : "bg-red-50 text-red-600"}`}
              >
                {c.isEnabled ? "Enabled" : "Disabled — tap to enable"}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "business-categories" && (
        <div className="space-y-2">
          {businessCategories.map((c) => (
            <div key={c.slug} className="border rounded-md p-3 flex items-center justify-between">
              <div className="text-sm">{c.label}</div>
              <button
                onClick={() => toggleBusinessCategory(c.slug, !c.isEnabled)}
                className={`text-xs px-2 py-1 rounded-md border ${c.isEnabled ? "" : "bg-red-50 text-red-600"}`}
              >
                {c.isEnabled ? "Enabled" : "Disabled — tap to enable"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
