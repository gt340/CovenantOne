"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Mentor = {
  id: string;
  userId: string;
  role: string;
  bio: string | null;
  specialties: string[];
  capacity: number;
  isActive: boolean;
  displayName: string;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  MARRIAGE_MENTOR: "Marriage Mentor",
  FAMILY_MENTOR: "Family Mentor",
  BUSINESS_MENTOR: "Business Mentor",
  FINANCIAL_MENTOR: "Financial Mentor",
};

export default function AdminMentorsPage() {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/mentors", { credentials: "include" });
    if (res.ok) setMentors((await res.json()).mentors ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setActive(id: string, isActive: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/mentors/${id}/approve`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update mentor.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = mentors.filter((m) => !m.isActive);
  const active = mentors.filter((m) => m.isActive);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Mentor Approvals</h1>
        <Link href="/mentors" className="text-sm text-blue-600">
          View live →
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Approve or deactivate mentor applications.</p>

      {error && <div className="text-red-600 text-xs mb-4">{error}</div>}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}

      {!loading && (
        <>
          <h2 className="text-sm font-medium text-gray-500 mb-2">Pending ({pending.length})</h2>
          <div className="space-y-2 mb-8">
            {pending.length === 0 && <div className="text-xs text-gray-400">No pending applications.</div>}
            {pending.map((m) => (
              <div key={m.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{m.displayName}</div>
                    <div className="text-xs text-gray-500">{ROLE_LABELS[m.role] ?? m.role} · capacity {m.capacity}</div>
                  </div>
                  <button
                    onClick={() => setActive(m.id, true)}
                    disabled={busyId === m.id}
                    className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50 flex-shrink-0"
                  >
                    {busyId === m.id ? "..." : "Approve"}
                  </button>
                </div>
                {m.bio && <p className="text-xs text-gray-600 mt-2">{m.bio}</p>}
              </div>
            ))}
          </div>

          <h2 className="text-sm font-medium text-gray-500 mb-2">Active ({active.length})</h2>
          <div className="space-y-2">
            {active.length === 0 && <div className="text-xs text-gray-400">No active mentors yet.</div>}
            {active.map((m) => (
              <div key={m.id} className="border rounded-md p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{m.displayName}</div>
                  <div className="text-xs text-gray-500">{ROLE_LABELS[m.role] ?? m.role}</div>
                </div>
                <button
                  onClick={() => setActive(m.id, false)}
                  disabled={busyId === m.id}
                  className="text-xs px-2 py-1 rounded-md border text-red-500 flex-shrink-0"
                >
                  {busyId === m.id ? "..." : "Deactivate"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
