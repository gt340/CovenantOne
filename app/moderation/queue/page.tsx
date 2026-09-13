"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type CaseRow = {
  id: string;
  status: string;
  priority: string;
  createdAt: string;
  report: {
    category: string;
    description: string;
    status: string;
    reportedUserId: string;
  } | null;
};

const PRIORITY_COLOR: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  NORMAL: "bg-gray-100 text-gray-600",
  LOW: "bg-gray-100 text-gray-400",
};

export default function ModerationQueuePage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/moderation/queue?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setCases(data.cases ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the queue.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Moderation Queue</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/moderation/flags" className="text-blue-600">
            Flags
          </Link>
          <Link href="/moderation/appeals" className="text-blue-600">
            Appeals
          </Link>
          <Link href="/moderation/analytics" className="text-blue-600">
            Analytics
          </Link>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">Sorted by priority, then oldest first.</p>

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="border rounded-md px-3 py-2 text-sm mb-4"
      >
        <option value="">Open, Investigating & Escalated</option>
        <option value="OPEN">Open only</option>
        <option value="INVESTIGATING">Investigating only</option>
        <option value="ESCALATED">Escalated only</option>
        <option value="ACTION_TAKEN">Action taken</option>
        <option value="CLOSED">Closed</option>
      </select>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      {!loading && !error && cases.length === 0 && (
        <div className="text-center text-gray-400 py-12">No cases in this view.</div>
      )}

      <div className="space-y-2">
        {cases.map((c) => (
          <Link
            key={c.id}
            href={`/moderation/cases/${c.id}`}
            className="block border rounded-lg p-4 bg-white hover:bg-gray-50"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{c.report?.category ?? "Unknown"}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLOR[c.priority] ?? "bg-gray-100"}`}>
                {c.priority}
              </span>
            </div>
            <p className="text-sm text-gray-600 line-clamp-2">{c.report?.description}</p>
            <div className="text-xs text-gray-400 mt-1">
              {c.status} · opened {new Date(c.createdAt).toLocaleDateString()}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
