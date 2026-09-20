"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Category = {
  slug: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isEnabled: boolean;
  postingRestricted: boolean;
};
type Post = {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  body: string;
  category: string | null;
  isFeatured: boolean;
  isRemoved: boolean;
  createdAt: string;
};
type Report = {
  id: string;
  reporterName: string;
  reportedUserName: string;
  reportedUserId: string;
  category: string;
  description: string;
  relatedContentType: "COMMUNITY_POST" | "COMMENT";
  relatedContentId: string;
  status: string;
  content: { title?: string; body: string; isRemoved: boolean } | null;
  createdAt: string;
};

type Tab = "categories" | "posts" | "reports";

export default function AdminCommunityPage() {
  const [tab, setTab] = useState<Tab>("reports");
  const [categories, setCategories] = useState<Category[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "categories") {
        const res = await fetch("/api/admin/community/categories", { credentials: "include" });
        if (res.ok) setCategories((await res.json()).categories ?? []);
      } else if (tab === "posts") {
        const res = await fetch("/api/admin/community/posts", { credentials: "include" });
        if (res.ok) setPosts((await res.json()).posts ?? []);
      } else {
        const res = await fetch("/api/admin/community/reports", { credentials: "include" });
        if (res.ok) setReports((await res.json()).reports ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateCategory(slug: string, update: Partial<Category>) {
    const res = await fetch(`/api/admin/community/categories/${slug}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (res.ok) load();
    else setError(`Could not update ${slug}`);
  }

  async function togglePostFlag(id: string, field: "isRemoved" | "isFeatured", value: boolean) {
    const res = await fetch(`/api/community/posts/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) load();
    else setError("Could not update post");
  }

  async function removeCommentById(id: string) {
    const res = await fetch(`/api/community/comments/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRemoved: true }),
    });
    if (res.ok) load();
    else setError("Could not remove comment");
  }

  async function dismissReport(id: string) {
    // Reuses the same reports table Phase 7 built — just marks it handled from here.
    const res = await fetch(`/api/admin/community/reports/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DISMISSED" }),
    });
    if (res.ok) load();
    else setError("Could not update report");
  }

  async function suspendUser(userId: string) {
    const days = window.prompt("Suspend from Community for how many days?", "7");
    if (!days) return;
    const reason = window.prompt("Reason (shown to the member):", "Community guidelines violation") ?? "";
    const res = await fetch("/api/admin/community/suspend", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, days: Number(days), reason }),
    });
    if (res.ok) {
      alert("Community suspension applied.");
      load();
    } else {
      setError("Could not suspend user");
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Community Admin</h1>
        <Link href="/community" className="text-sm text-blue-600">
          View live →
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Categories, featured posts, reported content, and suspensions.</p>

      <div className="flex gap-2 mb-6">
        {(["reports", "posts", "categories"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-1.5 rounded-md border capitalize ${tab === t ? "bg-blue-600 text-white" : ""}`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className="text-red-600 text-xs mb-4">{error}</div>}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}

      {!loading && tab === "categories" && (
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.slug} className="border rounded-md p-3">
              <div className="text-sm font-medium">{c.label}</div>
              <div className="text-xs text-gray-500 mb-2">{c.description}</div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => updateCategory(c.slug, { isEnabled: !c.isEnabled })}
                  className={`text-xs px-2 py-1 rounded-md border ${c.isEnabled ? "" : "bg-red-50 text-red-600"}`}
                >
                  {c.isEnabled ? "Enabled" : "Disabled — tap to enable"}
                </button>
                <button
                  onClick={() => updateCategory(c.slug, { postingRestricted: !c.postingRestricted })}
                  className={`text-xs px-2 py-1 rounded-md border ${c.postingRestricted ? "bg-amber-50 text-amber-700" : ""}`}
                >
                  {c.postingRestricted ? "Restricted (mods only)" : "Open posting — tap to restrict"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "posts" && (
        <div className="space-y-2">
          {posts.map((p) => (
            <div key={p.id} className="border rounded-md p-3">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {p.isFeatured && <span className="text-[10px] uppercase text-amber-600 font-semibold">Featured</span>}
                {p.isRemoved && <span className="text-[10px] uppercase text-red-600 font-semibold">Removed</span>}
              </div>
              <div className="text-sm font-medium">{p.title}</div>
              <div className="text-xs text-gray-500 mb-2">
                {p.authorName} · {p.category ?? "General"}
              </div>
              <p className="text-xs text-gray-600 mb-2 line-clamp-2">{p.body}</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => togglePostFlag(p.id, "isFeatured", !p.isFeatured)}
                  className="text-xs px-2 py-1 rounded-md border"
                >
                  {p.isFeatured ? "Unfeature" : "Feature"}
                </button>
                <button
                  onClick={() => togglePostFlag(p.id, "isRemoved", !p.isRemoved)}
                  className="text-xs px-2 py-1 rounded-md border text-red-600"
                >
                  {p.isRemoved ? "Restore" : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "reports" && (
        <div className="space-y-2">
          {reports.length === 0 && <div className="text-xs text-gray-400">No community reports.</div>}
          {reports.map((r) => (
            <div key={r.id} className="border rounded-md p-3">
              <div className="text-xs text-gray-500 mb-1">
                {r.reporterName} reported {r.reportedUserName}'s {r.relatedContentType === "COMMUNITY_POST" ? "post" : "comment"} ·{" "}
                {r.category.replace(/_/g, " ")} · <span className="uppercase">{r.status}</span>
              </div>
              <p className="text-xs text-gray-600 mb-1">"{r.description}"</p>
              {r.content && (
                <div className="bg-gray-50 rounded-md p-2 text-xs mb-2">
                  {r.content.title && <div className="font-medium">{r.content.title}</div>}
                  <div className={r.content.isRemoved ? "line-through text-gray-400" : ""}>{r.content.body}</div>
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                {r.relatedContentType === "COMMUNITY_POST" ? (
                  <button onClick={() => togglePostFlag(r.relatedContentId, "isRemoved", true)} className="text-xs px-2 py-1 rounded-md border text-red-600">
                    Remove post
                  </button>
                ) : (
                  <button onClick={() => removeCommentById(r.relatedContentId)} className="text-xs px-2 py-1 rounded-md border text-red-600">
                    Remove comment
                  </button>
                )}
                <button onClick={() => suspendUser(r.reportedUserId)} className="text-xs px-2 py-1 rounded-md border text-amber-700">
                  Suspend from Community
                </button>
                <button onClick={() => dismissReport(r.id)} className="text-xs px-2 py-1 rounded-md border">
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
