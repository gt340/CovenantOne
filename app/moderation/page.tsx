"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Analytics = {
  reports: { total: number; byStatus: Record<string, number> };
  cases: { total: number; open: number; avgResolutionHours: number | null };
  appeals: { total: number; byStatus: Record<string, number> };
  automatedFlags: { pendingReview: number; total: number };
};

const SECTIONS = [
  { label: "Queue", href: "/moderation/queue", description: "New and open reports awaiting triage" },
  { label: "Cases", href: "/moderation/cases", description: "Full case management — investigate, act, close" },
  { label: "AI Safety Flags", href: "/moderation/flags", description: "Heuristic-flagged content pending human review" },
  { label: "Appeals", href: "/moderation/appeals", description: "Member appeals of suspensions/bans" },
  { label: "Analytics", href: "/moderation/analytics", description: "Trends across reports, cases, actions, appeals" },
];

export default function ModerationHomePage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/moderation/analytics", { credentials: "include" });
      if (res.ok) setData(await res.json());
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Safety &amp; Moderation</h1>
      <p className="text-sm text-gray-500 mb-6">Your operational workspace. Every action here is audit-logged.</p>

      {!loading && data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <Metric label="Open cases" value={data.cases.open} />
          <Metric label="Pending flags" value={data.automatedFlags.pendingReview} />
          <Metric label="Open reports" value={data.reports.byStatus.OPEN ?? 0} />
          <Metric label="Pending appeals" value={data.appeals.byStatus.PENDING ?? 0} />
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="border rounded-md p-3 hover:bg-gray-50">
            <div className="text-sm font-medium">{s.label}</div>
            <div className="text-xs text-gray-500">{s.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
