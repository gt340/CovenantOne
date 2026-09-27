"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Metrics = {
  members: {
    total: number;
    byGender: Record<string, number>;
    verified: number;
    active: number;
    newRegistrations7d: number;
    newRegistrations30d: number;
  };
  connections: { total: number; byStage: Record<string, number> };
  reports: { total: number; open: number };
  safety: { suspensions: number; bans: number; communityBans: number };
  fundraising: {
    campaigns: { total: number; byStatus: Record<string, number> };
    donations: { completedCount: number; completedTotalCents: number };
  };
  events: { total: number; upcoming: number; byType: Record<string, number> };
  mentorship: { mentors: number; activeMentors: number; requests: number; sessions: number };
};

const SECTIONS: { label: string; href: string; description: string }[] = [
  { label: "Members", href: "/admin/members", description: "Search, verify, and open a member's full detail & history" },
  { label: "Verification", href: "/admin/members", description: "Community verification badge grants/revokes" },
  { label: "Community", href: "/admin/community", description: "Posts, comments, categories, reports" },
  { label: "Jobs & Businesses", href: "/admin/purpose-prosperity", description: "Job board and business directory moderation" },
  { label: "Fundraising", href: "/admin/fund", description: "Campaign review, disbursements, fund reports" },
  { label: "Mentors", href: "/admin/mentors", description: "Mentor applications and approvals" },
  { label: "Guidance", href: "/admin/guidance", description: "Marriage guidance article publishing" },
  { label: "Audit Logs", href: "/admin/audit-logs", description: "Every sensitive action, searchable" },
  { label: "Safety & Moderation Queue", href: "/moderation/queue", description: "Open reports awaiting triage (Moderator tier+)" },
  { label: "Moderation Cases", href: "/moderation/cases", description: "Full case management & investigation history" },
  { label: "AI Safety Flags", href: "/moderation/flags", description: "Heuristic-flagged content pending human review" },
  { label: "Appeals", href: "/moderation/appeals", description: "Member appeals of suspensions/bans" },
  { label: "Moderation Analytics", href: "/moderation/analytics", description: "Reports, cases, actions, appeals, flags — trends" },
];

function fmtCents(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/metrics", { credentials: "include" });
      if (res.ok) {
        setMetrics(await res.json());
      } else {
        const b = await res.json().catch(() => null);
        setError(b?.error ?? "Could not load metrics.");
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Admin Dashboard</h1>
      <p className="text-sm text-gray-500 mb-6">Platform-wide overview. Sensitive actions are logged — see Audit Logs.</p>

      {loading && <div className="text-center text-gray-400 py-12">Loading metrics...</div>}
      {error && <div className="text-red-600 text-sm mb-6">{error}</div>}

      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          <Metric label="Total members" value={metrics.members.total} />
          {Object.entries(metrics.members.byGender).map(([g, n]) => (
            <Metric key={g} label={g.charAt(0) + g.slice(1).toLowerCase()} value={n} />
          ))}
          <Metric label="Verified members" value={metrics.members.verified} />
          <Metric label="Active members" value={metrics.members.active} />
          <Metric label="New (7d)" value={metrics.members.newRegistrations7d} />
          <Metric label="New (30d)" value={metrics.members.newRegistrations30d} />
          <Metric label="Connections" value={metrics.connections.total} />
          <Metric label="Married" value={metrics.connections.byStage.MARRIED ?? 0} />
          <Metric label="Open reports" value={metrics.reports.open} sub={`${metrics.reports.total} total`} />
          <Metric label="Suspensions" value={metrics.safety.suspensions} />
          <Metric label="Bans" value={metrics.safety.bans} sub={`+${metrics.safety.communityBans} community-banned`} />
          <Metric label="Fundraising campaigns" value={metrics.fundraising.campaigns.total} />
          <Metric label="Donations" value={metrics.fundraising.donations.completedCount} sub={fmtCents(metrics.fundraising.donations.completedTotalCents)} />
          <Metric label="Events" value={metrics.events.total} sub={`${metrics.events.upcoming} upcoming`} />
          <Metric label="Mentors" value={metrics.mentorship.mentors} sub={`${metrics.mentorship.activeMentors} active`} />
          <Metric label="Mentorship sessions" value={metrics.mentorship.sessions} sub={`${metrics.mentorship.requests} requests`} />
        </div>
      )}

      {metrics && Object.keys(metrics.connections.byStage).length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium mb-2">Relationship progression</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(metrics.connections.byStage).map(([stage, n]) => (
              <span key={stage} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
                {stage.replace(/_/g, " ")}: {n}
              </span>
            ))}
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium mb-2">Sections</h2>
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

function Metric({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value.toLocaleString()}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
