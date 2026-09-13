"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Flag = {
  id: string;
  contentType: string;
  contentId: string;
  flaggedUserId: string;
  category: string;
  confidenceScore: number;
  detectionSource: string;
  matchedTerms: string[] | null;
  status: string;
  createdAt: string;
};

export default function ModerationFlagsPage() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/moderation/flags?status=PENDING_REVIEW", { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setFlags(data.flags ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load flags.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, decision: "CONFIRMED" | "DISMISSED") {
    setActingOn(id);
    try {
      const res = await fetch(`/api/moderation/flags/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not review flag.");
    } finally {
      setActingOn(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/moderation/queue" className="text-sm text-blue-600 mb-3 inline-block">
        ← Back to Queue
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Automated Flags</h1>
      <p className="text-sm text-gray-500 mb-6">
        Pre-screened by a keyword heuristic — not a judgment. Confirming opens a normal case for human
        investigation; nothing is punished automatically.
      </p>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">{error}</div>
      )}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      {!loading && flags.length === 0 && <div className="text-center text-gray-400 py-12">No pending flags.</div>}

      <div className="space-y-3">
        {flags.map((f) => (
          <div key={f.id} className="border rounded-lg p-4 bg-white">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{f.category.replace(/_/g, " ")}</span>
              <span className="text-xs text-gray-400">{Math.round(f.confidenceScore * 100)}% confidence</span>
            </div>
            <div className="text-xs text-gray-500 mb-2">
              {f.contentType} · flagged user: {f.flaggedUserId}
            </div>
            {f.matchedTerms && f.matchedTerms.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {f.matchedTerms.map((t, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    "{t}"
                  </span>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-400 mb-3">{new Date(f.createdAt).toLocaleString()}</div>
            <div className="flex gap-2">
              <button
                onClick={() => review(f.id, "CONFIRMED")}
                disabled={actingOn === f.id}
                className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
              >
                Confirm → open case
              </button>
              <button
                onClick={() => review(f.id, "DISMISSED")}
                disabled={actingOn === f.id}
                className="text-xs px-3 py-1.5 rounded-md border disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
