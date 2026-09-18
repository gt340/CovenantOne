"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Article = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  body: string;
  status: string;
  createdAt: string;
  publishedAt: string | null;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "PREPARING_FOR_MARRIAGE", label: "Preparing for Marriage" },
  { value: "CHOOSING_A_SPOUSE", label: "Choosing a Spouse" },
  { value: "COMMUNICATION", label: "Communication" },
  { value: "CONFLICT_RESOLUTION", label: "Conflict Resolution" },
  { value: "FAITH_AND_MARRIAGE", label: "Faith and Marriage" },
  { value: "FAMILY", label: "Family" },
  { value: "FINANCIAL_PLANNING", label: "Financial Planning" },
  { value: "BUSINESS_AND_MARRIAGE", label: "Business and Marriage" },
  { value: "EMOTIONAL_MATURITY", label: "Emotional Maturity" },
  { value: "RESPONSIBLE_COURTSHIP", label: "Responsible Courtship" },
  { value: "MARRIAGE_PREPARATION", label: "Marriage Preparation" },
  { value: "LIFE_AFTER_MARRIAGE", label: "Life After Marriage" },
];

export default function AdminGuidancePage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Article | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/guidance/articles?mine=true", { credentials: "include" });
    if (res.ok) setArticles((await res.json()).articles ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteArticle(id: string) {
    if (!window.confirm("Delete this article? This can't be undone.")) return;
    await fetch(`/api/guidance/articles/${id}`, { method: "DELETE", credentials: "include" });
    await load();
  }

  if (editing) {
    return (
      <ArticleEditor
        article={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Guidance Content</h1>
        <Link href="/guidance" className="text-sm text-blue-600">
          View live →
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Manage articles for the Marriage Guidance Center.</p>

      <button onClick={() => setEditing("new")} className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white mb-6">
        + New Article
      </button>

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      <div className="space-y-2">
        {articles.map((a) => (
          <div key={a.id} className="border rounded-md p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{a.title}</div>
              <div className="text-xs text-gray-500">
                {CATEGORIES.find((c) => c.value === a.category)?.label ?? a.category} ·{" "}
                <span className={a.status === "PUBLISHED" ? "text-green-600" : "text-gray-400"}>{a.status}</span>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setEditing(a)} className="text-xs px-2 py-1 rounded-md border">
                Edit
              </button>
              <button onClick={() => deleteArticle(a.id)} className="text-xs px-2 py-1 rounded-md border text-red-500">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArticleEditor({
  article,
  onClose,
  onSaved,
}: {
  article: Article | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(article?.title ?? "");
  const [category, setCategory] = useState(article?.category ?? CATEGORIES[0].value);
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(status: "DRAFT" | "PUBLISHED") {
    if (!title.trim() || !body.trim()) {
      setError("Title and body are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { title: title.trim(), category, summary: summary.trim() || undefined, body: body.trim(), status };
      const res = article
        ? await fetch(`/api/guidance/articles/${article.id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/guidance/articles", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <button onClick={onClose} className="text-sm text-blue-600 mb-3">
        ← Back
      </button>
      <h1 className="text-xl font-semibold mb-4">{article ? "Edit Article" : "New Article"}</h1>

      <div className="space-y-3">
        <input
          type="text"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Short summary (optional)"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Article body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          className="w-full border rounded-md px-3 py-2 text-sm font-mono"
        />
        {error && <div className="text-red-600 text-xs">{error}</div>}
        <div className="flex gap-2">
          <button onClick={() => save("DRAFT")} disabled={saving} className="px-4 py-2 text-sm rounded-md border disabled:opacity-50">
            Save Draft
          </button>
          <button
            onClick={() => save("PUBLISHED")}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
