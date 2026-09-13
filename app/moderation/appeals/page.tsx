"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Appeal = {
  id: string;
  caseId: string;
  submittedByUserId: string;
  reason: string;
  status: string;
  createdAt: string;
};

export default function ModerationAppealsPage() {
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/moderation/appeals", { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setAppeals((data.appeals ?? []).filter((a: Appeal) => a.status === "PENDING" || a.status === "UNDER_REVIEW"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load appeals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, decision: "GRANTED" | "DENIED") {
    setActingOn(id);
    try {
      const res = await fetch(`/api/moderation/appeals/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reviewNotes: reviewNotes[id]?.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not review appeal.");
    } finally {
      setActingOn(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/moderation/queue" className="text-sm text-blue-600 mb-3 inline-block">
        ← Back to Queue
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Appeals</h1>
      <p className="text-sm text-gray-500 mb-6">
        Granting reinstates the account and closes the case; denying closes the case without changing anything.
      </p>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">{error}</div>
      )}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      {!loading && appeals.length === 0 && <div className="text-center text-gray-400 py-12">No pending appeals.</div>}

      <div className="space-y-3">
        {appeals.map((a) => (
          <div key={a.id} className="border rounded-lg p-4 bg-white">
            <div className="text-xs text-gray-400 mb-1">
              Case: <Link href={`/moderation/cases/${a.caseId}`} className="text-blue-600">{a.caseId}</Link>
            </div>
            <p className="text-sm text-gray-700 mb-2">{a.reason}</p>
            <div className="text-xs text-gray-400 mb-3">{new Date(a.createdAt).toLocaleString()}</div>
            <textarea
              value={reviewNotes[a.id] ?? ""}
              onChange={(e) => setReviewNotes((prev) => ({ ...prev, [a.id]: e.target.value }))}
              placeholder="Review notes (optional)"
              rows={2}
              className="w-full border rounded-md px-3 py-2 text-sm mb-2"
            />
            <div className="flex gap-2">
              <button
                onClick={() => review(a.id, "GRANTED")}
                disabled={actingOn === a.id}
                className="text-xs px-3 py-1.5 rounded-md bg-green-600 text-white disabled:opacity-50"
              >
                Grant
              </button>
              <button
                onClick={() => review(a.id, "DENIED")}
                disabled={actingOn === a.id}
                className="text-xs px-3 py-1.5 rounded-md border disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
