"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Category = { slug: string; label: string; description: string | null; postingRestricted: boolean };
type Post = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  isFeatured: boolean;
  authorName: string;
  commentCount: number;
  reactionCount: number;
  createdAt: string;
};

export default function CommunityPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/community/categories", { credentials: "include" });
    if (res.ok) setCategories((await res.json()).categories ?? []);
  }, []);

  const loadPosts = useCallback(async (category: string | null) => {
    setLoading(true);
    const url = category ? `/api/community/posts?category=${category}` : "/api/community/posts";
    const res = await fetch(url, { credentials: "include" });
    if (res.ok) setPosts((await res.json()).posts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadPosts(activeCategory);
  }, [activeCategory, loadPosts]);

  const activeCat = categories.find((c) => c.slug === activeCategory);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Community</h1>
      <p className="text-sm text-gray-500 mb-6">Marriage, faith, business, family, and life together.</p>

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

      {(!activeCat || !activeCat.postingRestricted) && (
        <button
          onClick={() => setShowCompose((s) => !s)}
          className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white mb-6"
        >
          {showCompose ? "Cancel" : "+ New Post"}
        </button>
      )}
      {activeCat?.postingRestricted && (
        <p className="text-xs text-gray-400 mb-6">Only moderators/admins can post in {activeCat.label}.</p>
      )}

      {showCompose && (
        <ComposeForm
          categories={categories}
          defaultCategory={activeCategory}
          onPosted={() => {
            setShowCompose(false);
            loadPosts(activeCategory);
          }}
        />
      )}

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      <div className="space-y-3">
        {!loading && posts.length === 0 && (
          <div className="text-sm text-gray-400 py-8 text-center">No posts here yet — be the first.</div>
        )}
        {posts.map((p) => (
          <Link
            key={p.id}
            href={`/community/${p.id}`}
            className="block border rounded-md p-3 hover:bg-gray-50"
          >
            {p.isFeatured && (
              <span className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Featured</span>
            )}
            <div className="text-sm font-medium">{p.title}</div>
            <div className="text-xs text-gray-500 mb-1">
              {p.authorName} · {categories.find((c) => c.slug === p.category)?.label ?? p.category ?? "General"}
            </div>
            <p className="text-xs text-gray-600 line-clamp-2">{p.body}</p>
            <div className="text-xs text-gray-400 mt-2">
              {p.reactionCount} reaction{p.reactionCount === 1 ? "" : "s"} · {p.commentCount} comment
              {p.commentCount === 1 ? "" : "s"}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ComposeForm({
  categories,
  defaultCategory,
  onPosted,
}: {
  categories: Category[];
  defaultCategory: string | null;
  onPosted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState(defaultCategory ?? categories[0]?.slug ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const postableCategories = categories.filter((c) => !c.postingRestricted);

  async function submit() {
    if (!title.trim() || !body.trim()) {
      setError("Title and body are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), category: category || null }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-md p-3 mb-6 space-y-2">
      <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
        {postableCategories.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
      <textarea
        placeholder="What's on your mind?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
        {saving ? "Posting..." : "Post"}
      </button>
    </div>
  );
}
