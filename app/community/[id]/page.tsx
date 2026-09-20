"use client";

import { useState, useEffect, useCallback, use as usePromise } from "react";
import Link from "next/link";

type Post = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  authorName: string;
  isFeatured: boolean;
  reactionCounts: Record<string, number>;
  myReaction: string | null;
  createdAt: string;
};
type Comment = {
  id: string;
  authorId: string;
  authorName: string;
  parentCommentId: string | null;
  body: string;
  createdAt: string;
};

const REACTIONS = [
  { type: "LIKE", emoji: "👍" },
  { type: "AMEN", emoji: "🙏" },
  { type: "PRAY", emoji: "🕊️" },
  { type: "CELEBRATE", emoji: "🎉" },
  { type: "ENCOURAGE", emoji: "💛" },
];
const REPORT_CATEGORIES = ["HARASSMENT", "INAPPROPRIATE_CONTENT", "SCAM_OR_FINANCIAL", "FRAUD", "OTHER"];

export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [reportTarget, setReportTarget] = useState<{ kind: "post" | "comment"; id: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [postRes, commentsRes] = await Promise.all([
      fetch(`/api/community/posts/${id}`, { credentials: "include" }),
      fetch(`/api/community/posts/${id}/comments`, { credentials: "include" }),
    ]);
    if (postRes.ok) setPost(await postRes.json());
    if (commentsRes.ok) setComments((await commentsRes.json()).comments ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function react(type: string) {
    const res = await fetch(`/api/community/posts/${id}/reactions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (res.ok) load();
  }

  async function submitComment() {
    if (!commentBody.trim()) return;
    const res = await fetch(`/api/community/posts/${id}/comments`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: commentBody.trim() }),
    });
    if (res.ok) {
      setCommentBody("");
      load();
    }
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-400">Loading...</div>;
  if (!post) return <div className="max-w-2xl mx-auto px-4 py-8">Post not found.</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/community" className="text-sm text-blue-600 mb-3 inline-block">
        ← Back to Community
      </Link>

      {post.isFeatured && <span className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Featured</span>}
      <h1 className="text-xl font-semibold">{post.title}</h1>
      <div className="text-xs text-gray-500 mb-3">{post.authorName}</div>
      <p className="text-sm whitespace-pre-wrap mb-4">{post.body}</p>

      <div className="flex gap-2 flex-wrap mb-2">
        {REACTIONS.map((r) => (
          <button
            key={r.type}
            onClick={() => react(r.type)}
            className={`text-xs px-2 py-1 rounded-md border ${post.myReaction === r.type ? "bg-blue-50 border-blue-400" : ""}`}
          >
            {r.emoji} {post.reactionCounts[r.type] ?? 0}
          </button>
        ))}
      </div>
      <button onClick={() => setReportTarget({ kind: "post", id: post.id })} className="text-xs text-gray-400 mb-6">
        Report post
      </button>

      <h2 className="text-sm font-medium text-gray-500 mb-2">Comments ({comments.length})</h2>
      <div className="space-y-2 mb-4">
        {comments.map((c) => (
          <div key={c.id} className="border rounded-md p-2">
            <div className="text-xs font-medium">{c.authorName}</div>
            <p className="text-sm">{c.body}</p>
            <button onClick={() => setReportTarget({ kind: "comment", id: c.id })} className="text-[10px] text-gray-400">
              Report
            </button>
          </div>
        ))}
        {comments.length === 0 && <div className="text-xs text-gray-400">No comments yet.</div>}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add a comment..."
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={submitComment} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white">
          Post
        </button>
      </div>

      {reportTarget && (
        <ReportModal
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onDone={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}

function ReportModal({
  target,
  onClose,
  onDone,
}: {
  target: { kind: "post" | "comment"; id: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [category, setCategory] = useState(REPORT_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!description.trim()) {
      setError("Please describe the issue.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const path =
        target.kind === "post"
          ? `/api/community/posts/${target.id}/report`
          : `/api/community/comments/${target.id}/report`;
      const res = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, description: description.trim() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit report.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-4 z-50">
      <div className="bg-white rounded-md p-4 w-full max-w-sm space-y-2">
        <h3 className="text-sm font-medium">Report {target.kind}</h3>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
          {REPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <textarea
          placeholder="What's wrong with this content?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        {error && <div className="text-red-600 text-xs">{error}</div>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-sm rounded-md border">
            Cancel
          </button>
          <button onClick={submit} disabled={saving} className="flex-1 px-3 py-2 text-sm rounded-md bg-red-600 text-white disabled:opacity-50">
            {saving ? "Sending..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
