"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

function money(cents: number) {
  return `GH₵${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Campaign = {
  id: string;
  organizerName: string;
  title: string;
  category: string;
  goalAmountCents: number;
  raisedAmountCents: number;
  status: string;
  verificationStatus: string;
  deadline: string;
};
type Report = { id: string; reporterId: string; reportedUserId: string; category: string; description: string; relatedContentId: string; campaignTitle: string; status: string };
type Disbursement = { id: string; campaignId: string; campaignTitle: string; amountCents: number; recipientDescription: string; status: string };

type Tab = "campaigns" | "reports" | "disbursements";

export default function AdminFundPage() {
  const [tab, setTab] = useState<Tab>("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/fund", { credentials: "include" });
    if (res.ok) {
      const d = await res.json();
      setCampaigns(d.campaigns ?? []);
      setReports(d.reports ?? []);
      setDisbursements(d.disbursements ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updateCampaign(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      load();
    } else {
      const b = await res.json().catch(() => null);
      setError(`Could not update campaign: ${b?.error ?? res.status}`);
    }
  }

  async function updateDisbursement(id: string, status: string) {
    const res = await fetch(`/api/disbursements/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      load();
    } else {
      const b = await res.json().catch(() => null);
      setError(`Could not update disbursement: ${b?.error ?? res.status}`);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Community Support Fund — Admin</h1>
        <Link href="/fund" className="text-sm text-blue-600">View live →</Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Review campaigns, handle reports, and approve payouts.</p>

      <div className="flex gap-2 mb-6">
        {(["campaigns", "reports", "disbursements"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`text-sm px-3 py-1.5 rounded-md border capitalize ${tab === t ? "bg-blue-600 text-white" : ""}`}>
            {t}
          </button>
        ))}
      </div>

      {error && <div className="text-red-600 text-xs mb-4">{error}</div>}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}

      {!loading && tab === "campaigns" && (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="border rounded-md p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase text-gray-400">{c.status}</span>
                <span className="text-[10px] uppercase text-gray-400">Verification: {c.verificationStatus}</span>
              </div>
              <div className="text-sm font-medium">{c.title}</div>
              <div className="text-xs text-gray-500 mb-2">
                by {c.organizerName} · {money(c.raisedAmountCents)} / {money(c.goalAmountCents)} · deadline {new Date(c.deadline).toLocaleDateString()}
              </div>
              <textarea
                placeholder="Review note (optional)"
                value={notesById[c.id] ?? ""}
                onChange={(e) => setNotesById((prev) => ({ ...prev, [c.id]: e.target.value }))}
                rows={2}
                className="w-full border rounded-md px-2 py-1 text-xs mb-2"
              />
              <div className="flex gap-2 flex-wrap">
                {c.status === "SUBMITTED" && (
                  <button onClick={() => updateCampaign(c.id, { status: "UNDER_REVIEW", reviewNotes: notesById[c.id] })} className="text-xs px-2 py-1 rounded-md border">
                    Start Review
                  </button>
                )}
                {c.status === "UNDER_REVIEW" && (
                  <>
                    <button onClick={() => updateCampaign(c.id, { verificationStatus: "VERIFIED" })} className="text-xs px-2 py-1 rounded-md border text-green-700">
                      Mark Verified
                    </button>
                    <button onClick={() => updateCampaign(c.id, { status: "APPROVED", reviewNotes: notesById[c.id] })} className="text-xs px-2 py-1 rounded-md border text-green-700">
                      Approve
                    </button>
                    <button onClick={() => updateCampaign(c.id, { status: "REJECTED", reviewNotes: notesById[c.id] })} className="text-xs px-2 py-1 rounded-md border text-red-600">
                      Reject
                    </button>
                  </>
                )}
                {c.status === "APPROVED" && (
                  <button onClick={() => updateCampaign(c.id, { status: "ACTIVE" })} className="text-xs px-2 py-1 rounded-md border text-green-700">
                    Publish (Go Active)
                  </button>
                )}
                {c.status === "ACTIVE" && (
                  <button onClick={() => updateCampaign(c.id, { status: "COMPLETED" })} className="text-xs px-2 py-1 rounded-md border">
                    Mark Completed
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "reports" && (
        <div className="space-y-2">
          {reports.length === 0 && <div className="text-xs text-gray-400">No reports.</div>}
          {reports.map((r) => (
            <div key={r.id} className="border rounded-md p-3">
              <div className="text-xs text-gray-500 mb-1">
                {r.campaignTitle} · {r.category.replace(/_/g, " ")} · <span className="uppercase">{r.status}</span>
              </div>
              <p className="text-xs text-gray-600 mb-2">"{r.description}"</p>
              <Link href={`/fund/${r.relatedContentId}`} className="text-xs text-blue-600 underline">
                View campaign →
              </Link>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "disbursements" && (
        <div className="space-y-2">
          {disbursements.length === 0 && <div className="text-xs text-gray-400">No pending payout requests.</div>}
          {disbursements.map((d) => (
            <div key={d.id} className="border rounded-md p-3">
              <div className="text-sm font-medium">{d.campaignTitle}</div>
              <div className="text-xs text-gray-500 mb-2">{money(d.amountCents)} · {d.recipientDescription}</div>
              <div className="flex gap-2">
                <button onClick={() => updateDisbursement(d.id, "APPROVED")} className="text-xs px-2 py-1 rounded-md border text-green-700">
                  Approve
                </button>
                <button onClick={() => updateDisbursement(d.id, "PAID")} className="text-xs px-2 py-1 rounded-md border text-blue-700">
                  Mark Paid
                </button>
                <button onClick={() => updateDisbursement(d.id, "REJECTED")} className="text-xs px-2 py-1 rounded-md border text-red-600">
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
