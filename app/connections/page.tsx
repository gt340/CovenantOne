"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type ConnectionSummary = {
  id: string;
  status: string;
  currentStageLabel: string;
  hasPendingProposal: boolean;
  otherMember: { id: string; displayName: string; headlinePhotoUrl: string | null };
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/connections", { credentials: "include" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        setConnections(data.connections ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load connections.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Your Connections</h1>
      <p className="text-sm text-gray-500 mb-6">
        People you're on a relationship journey with, from Friendship onward.
      </p>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      {!loading && !error && connections.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          No connections yet. Accepted friendship requests will show up here.
        </div>
      )}

      <div className="space-y-3">
        {connections.map((c) => (
          <Link
            key={c.id}
            href={`/connections/${c.id}`}
            className="flex items-center gap-3 border rounded-lg p-4 bg-white hover:bg-gray-50"
          >
            <div className="w-12 h-12 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
              {c.otherMember.headlinePhotoUrl ? (
                <img src={c.otherMember.headlinePhotoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">
                  {c.otherMember.displayName?.[0] ?? "?"}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{c.otherMember.displayName}</div>
              <div className="text-xs text-gray-500">
                {c.status === "ENDED" ? "Ended" : c.currentStageLabel}
                {c.hasPendingProposal && c.status === "ACTIVE" && (
                  <span className="ml-2 text-yellow-600">· Stage change pending</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
