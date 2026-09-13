"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Analytics = {
  reports: { total: number; byCategory: Record<string, number>; byStatus: Record<string, number> };
  cases: { total: number; byStatus: Record<string, number>; byPriority: Record<string, number>; open: number; avgResolutionHours: number | null };
  actions: { total: number; byType: Record<string, number> };
  appeals: { total: number; byStatus: Record<string, number> };
  automatedFlags: { total: number; byStatus: Record<string, number>; byCategory: Record<string, number>; pendingReview: number };
};

function BreakdownList({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <div className="text-xs text-gray-400">None yet</div>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between text-sm">
          <span className="text-gray-600">{k.replace(/_/g, " ")}</span>
          <span className="font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function ModerationAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/moderation/analytics", { credentials: "include" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load analytics.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-12 text-center text-gray-400">Loading...</div>;
  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/moderation/queue" className="text-sm text-blue-600 mb-3 inline-block">
        ← Back to Queue
      </Link>
      <h1 className="text-2xl font-semibold mb-6">Moderation Analytics</h1>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="border rounded-md p-4">
          <div className="text-2xl font-semibold">{data.cases.open}</div>
          <div className="text-xs text-gray-500">Open cases</div>
        </div>
        <div className="border rounded-md p-4">
          <div className="text-2xl font-semibold">
            {data.cases.avgResolutionHours !== null ? `${data.cases.avgResolutionHours}h` : "—"}
          </div>
          <div className="text-xs text-gray-500">Avg. resolution time</div>
        </div>
        <div className="border rounded-md p-4">
          <div className="text-2xl font-semibold">{data.automatedFlags.pendingReview}</div>
          <div className="text-xs text-gray-500">Flags pending review</div>
        </div>
        <div className="border rounded-md p-4">
          <div className="text-2xl font-semibold">{data.appeals.byStatus["PENDING"] ?? 0}</div>
          <div className="text-xs text-gray-500">Pending appeals</div>
        </div>
      </div>

      <div className="space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Reports by category ({data.reports.total} total)</h2>
          <BreakdownList data={data.reports.byCategory} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Cases by status ({data.cases.total} total)</h2>
          <BreakdownList data={data.cases.byStatus} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Actions taken ({data.actions.total} total)</h2>
          <BreakdownList data={data.actions.byType} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Automated flags by category ({data.automatedFlags.total} total)</h2>
          <BreakdownList data={data.automatedFlags.byCategory} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Appeals by outcome ({data.appeals.total} total)</h2>
          <BreakdownList data={data.appeals.byStatus} />
        </section>
      </div>
    </div>
  );
}
