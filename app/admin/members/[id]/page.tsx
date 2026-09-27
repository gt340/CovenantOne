"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Detail = {
  profile: { displayName: string; gender: string; communityVerified: boolean; dateOfBirth: string | null };
  account: {
    id: string;
    role: string;
    status: string;
    email: string | null;
    createdAt: string;
    suspendedUntil: string | null;
    communityBannedUntil: string | null;
    communityBanReason: string | null;
    phoneVerified: boolean;
    identityVerified: boolean;
  };
  connections: { id: string; userAId: string; userBId: string; currentStage: string; createdAt: string }[];
  reportsFiled: { id: string; category: string; status: string; description: string; createdAt: string }[];
  reportsAgainst: { id: string; category: string; status: string; description: string; createdAt: string }[];
  moderationCases: { id: string; reportId: string; status: string; priority: string; createdAt: string; closedAt: string | null }[];
  moderatorActions: { id: string; caseId: string; actionType: string; notes: string | null; createdAt: string }[];
};

export default function MemberDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/admin/members/${params.id}`, { credentials: "include" });
      if (res.ok) {
        setDetail(await res.json());
      } else {
        const b = await res.json().catch(() => null);
        setError(b?.error ?? `Request failed (${res.status})`);
      }
      setLoading(false);
    })();
  }, [params.id]);

  if (loading) return <div className="text-center text-gray-400 py-12">Loading...</div>;
  if (error || !detail) return <div className="max-w-3xl mx-auto px-4 py-8 text-sm text-red-600">{error ?? "Not found."}</div>;

  const { profile, account, connections, reportsFiled, reportsAgainst, moderationCases, moderatorActions } = detail;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/admin/members" className="text-xs text-blue-600">
        ← Back to Members
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-1">{profile.displayName}</h1>
      <div className="text-sm text-gray-500 mb-6">
        {account.email} · {profile.gender} · Joined {new Date(account.createdAt).toLocaleDateString()}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-8">
        <InfoCard label="Account status" value={account.status} accent={account.status === "ACTIVE" ? "green" : "red"} />
        <InfoCard label="Role" value={account.role} />
        <InfoCard label="Community verified" value={profile.communityVerified ? "Yes" : "No"} />
        <InfoCard label="Phone verified" value={account.phoneVerified ? "Yes" : "No"} />
        <InfoCard label="Identity verified" value={account.identityVerified ? "Yes" : "No"} />
        <InfoCard
          label="Suspended until"
          value={account.suspendedUntil ? new Date(account.suspendedUntil).toLocaleString() : "—"}
          accent={account.suspendedUntil ? "amber" : undefined}
        />
      </div>

      {account.communityBannedUntil && (
        <div className="border border-red-200 bg-red-50 rounded-md p-3 text-sm text-red-700 mb-6">
          Community-banned until {new Date(account.communityBannedUntil).toLocaleString()}
          {account.communityBanReason ? ` — ${account.communityBanReason}` : ""}
        </div>
      )}

      <Section title={`Connections (${connections.length})`}>
        {connections.length === 0 && <Empty />}
        {connections.map((c) => (
          <Row key={c.id}>
            <span className="font-medium">{c.currentStage.replace(/_/g, " ")}</span>
            <span className="text-gray-400"> · since {new Date(c.createdAt).toLocaleDateString()}</span>
          </Row>
        ))}
      </Section>

      <Section title={`Reports filed by this member (${reportsFiled.length})`}>
        {reportsFiled.length === 0 && <Empty />}
        {reportsFiled.map((r) => (
          <Row key={r.id}>
            <span className="font-medium">{r.category}</span>
            <span className="text-gray-400"> · {r.status} · {new Date(r.createdAt).toLocaleDateString()}</span>
          </Row>
        ))}
      </Section>

      <Section title={`Reports against this member (${reportsAgainst.length})`}>
        {reportsAgainst.length === 0 && <Empty />}
        {reportsAgainst.map((r) => (
          <Row key={r.id}>
            <span className="font-medium">{r.category}</span>
            <span className="text-gray-400"> · {r.status} · {new Date(r.createdAt).toLocaleDateString()}</span>
            <div className="text-xs text-gray-500 mt-0.5">{r.description}</div>
          </Row>
        ))}
      </Section>

      <Section title={`Moderation cases (${moderationCases.length})`}>
        {moderationCases.length === 0 && <Empty />}
        {moderationCases.map((c) => (
          <Row key={c.id}>
            <span className="font-medium">{c.status}</span>
            <span className="text-gray-400"> · {c.priority} priority · opened {new Date(c.createdAt).toLocaleDateString()}</span>
            {c.closedAt && <span className="text-gray-400"> · closed {new Date(c.closedAt).toLocaleDateString()}</span>}
          </Row>
        ))}
      </Section>

      <Section title={`Moderator actions (${moderatorActions.length})`}>
        {moderatorActions.length === 0 && <Empty />}
        {moderatorActions.map((a) => (
          <Row key={a.id}>
            <span className="font-medium">{a.actionType}</span>
            <span className="text-gray-400"> · {new Date(a.createdAt).toLocaleDateString()}</span>
            {a.notes && <div className="text-xs text-gray-500 mt-0.5">{a.notes}</div>}
          </Row>
        ))}
      </Section>

      <Link href="/moderation/cases" className="text-xs text-blue-600">
        Open full case management in Moderation →
      </Link>
    </div>
  );
}

function InfoCard({ label, value, accent }: { label: string; value: string; accent?: "green" | "red" | "amber" }) {
  const color = accent === "green" ? "text-green-600" : accent === "red" ? "text-red-600" : accent === "amber" ? "text-amber-600" : "";
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-medium ${color}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-medium mb-2">{title}</h2>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="border rounded-md px-3 py-2 text-sm">{children}</div>;
}

function Empty() {
  return <div className="text-xs text-gray-400 px-1">None.</div>;
}
