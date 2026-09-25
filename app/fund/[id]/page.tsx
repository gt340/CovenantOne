"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function money(cents: number) {
  return `GH₵${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type CampaignDetail = {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  category: string;
  goalAmountCents: number;
  raisedAmountCents: number;
  status: string;
  deadline: string;
  verificationStatus: string;
  reviewNotes: string | null;
  beneficiaryName: string;
  beneficiaryRelationship: string;
  organizerName: string;
  donations: { id: string; amountCents: number; donorName: string; createdAt: string }[];
  evidence: { id: string; description: string; storageKey: string | null }[];
};

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [donateAmount, setDonateAmount] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [donating, setDonating] = useState(false);
  const [donateError, setDonateError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [evidenceDesc, setEvidenceDesc] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutDesc, setPayoutDesc] = useState("");
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/campaigns/${id}`, { credentials: "include" });
    if (res.ok) setCampaign(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCurrentUserId(d?.id ?? null))
      .catch(() => setCurrentUserId(null))
      .finally(() => setAuthChecked(true));
  }, []);

  async function donate() {
    const amount = Number(donateAmount);
    if (!amount || amount <= 0) {
      setDonateError("Enter a valid amount.");
      return;
    }
    setDonating(true);
    setDonateError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/donate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, isAnonymous }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setCheckoutUrl(data.checkoutUrl);
    } catch (err) {
      setDonateError(err instanceof Error ? err.message : "Could not start donation.");
    } finally {
      setDonating(false);
    }
  }

  async function addEvidence() {
    if (!evidenceDesc.trim()) return;
    setUploadingEvidence(true);
    try {
      let storageKey: string | undefined;
      if (evidenceFile && currentUserId) {
        const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const ext = evidenceFile.name.split(".").pop() || "pdf";
        const path = `${currentUserId}/${id}-${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("campaign-evidence").upload(path, evidenceFile);
        if (uploadErr) throw uploadErr;
        storageKey = path;
      }
      await fetch(`/api/campaigns/${id}/evidence`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: evidenceDesc.trim(), storageKey }),
      });
      setEvidenceDesc("");
      setEvidenceFile(null);
      await load();
    } finally {
      setUploadingEvidence(false);
    }
  }

  async function requestPayout() {
    const amount = Number(payoutAmount);
    if (!amount || amount <= 0 || !payoutDesc.trim()) return;
    setRequestingPayout(true);
    try {
      const res = await fetch(`/api/campaigns/${id}/disbursements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, recipientDescription: payoutDesc.trim() }),
      });
      if (res.ok) {
        setPayoutAmount("");
        setPayoutDesc("");
        alert("Payout requested — pending admin approval.");
      }
    } finally {
      setRequestingPayout(false);
    }
  }

  if (loading || !authChecked) return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-400">Loading...</div>;
  if (!campaign) return <div className="max-w-2xl mx-auto px-4 py-8">Campaign not found.</div>;

  const isOrganizer = campaign.organizerId === currentUserId;
  const pct = Math.min(100, Math.round((campaign.raisedAmountCents / campaign.goalAmountCents) * 100));

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/fund" className="text-sm text-blue-600 mb-3 inline-block">← Back to Community Support Fund</Link>

      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] uppercase text-gray-400">{campaign.status}</span>
        {campaign.verificationStatus === "VERIFIED" && <span className="text-[10px] uppercase text-green-600 font-semibold">✓ Verified</span>}
      </div>
      <h1 className="text-xl font-semibold">{campaign.title}</h1>
      <div className="text-xs text-gray-500 mb-3">
        by {campaign.organizerName} · Beneficiary: {campaign.beneficiaryName} ({campaign.beneficiaryRelationship})
      </div>
      <p className="text-sm whitespace-pre-wrap mb-4">{campaign.description}</p>

      <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
        <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-sm text-gray-600 mb-1">
        {money(campaign.raisedAmountCents)} raised of {money(campaign.goalAmountCents)} goal
      </div>
      <div className="text-xs text-gray-400 mb-4">Deadline: {new Date(campaign.deadline).toLocaleDateString()}</div>

      {campaign.reviewNotes && (
        <div className="border border-amber-200 bg-amber-50 rounded-md p-2 text-xs text-amber-700 mb-4">
          <strong>Reviewer note:</strong> {campaign.reviewNotes}
        </div>
      )}

      {campaign.status === "ACTIVE" && !isOrganizer && (
        <div className="border rounded-md p-3 mb-4">
          <div className="text-sm font-medium mb-2">Support this campaign</div>
          {checkoutUrl ? (
            <a href={checkoutUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">
              Continue to secure payment →
            </a>
          ) : (
            <>
              <input type="number" placeholder="Amount (GHS)" value={donateAmount} onChange={(e) => setDonateAmount(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm mb-2" />
              <label className="flex items-center gap-2 text-xs mb-2">
                <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
                Donate anonymously
              </label>
              {donateError && <div className="text-red-600 text-xs mb-2">{donateError}</div>}
              <button onClick={donate} disabled={donating} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
                {donating ? "Starting..." : "Donate"}
              </button>
            </>
          )}
        </div>
      )}

      {isOrganizer && campaign.status === "SUBMITTED" && (
        <div className="border rounded-md p-3 mb-4 space-y-2">
          <div className="text-xs font-medium">Add supporting evidence</div>
          <input type="text" placeholder="What does this document show?" value={evidenceDesc} onChange={(e) => setEvidenceDesc(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)} className="text-xs" />
          <button onClick={addEvidence} disabled={uploadingEvidence} className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50">
            {uploadingEvidence ? "Uploading..." : "Add Evidence"}
          </button>
          <div className="text-xs text-gray-500">
            {campaign.evidence.length} item{campaign.evidence.length === 1 ? "" : "s"} submitted
          </div>
        </div>
      )}

      {isOrganizer && campaign.status === "COMPLETED" && (
        <div className="border rounded-md p-3 mb-4 space-y-2">
          <div className="text-xs font-medium">Request payout</div>
          <input type="number" placeholder={`Up to ${money(campaign.raisedAmountCents)}`} value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
          <input type="text" placeholder="Recipient / payout details" value={payoutDesc} onChange={(e) => setPayoutDesc(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
          <button onClick={requestPayout} disabled={requestingPayout} className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50">
            {requestingPayout ? "Requesting..." : "Request Payout"}
          </button>
        </div>
      )}

      <h2 className="text-sm font-medium text-gray-500 mb-2">Donation History ({campaign.donations.length})</h2>
      <div className="space-y-1 mb-4">
        {campaign.donations.length === 0 && <div className="text-xs text-gray-400">No donations yet.</div>}
        {campaign.donations.map((d) => (
          <div key={d.id} className="flex justify-between text-xs border-b pb-1">
            <span>{d.donorName}</span>
            <span className="font-medium">{money(d.amountCents)}</span>
          </div>
        ))}
      </div>

      {!isOrganizer && (
        <button onClick={() => setReportOpen(true)} className="text-xs text-gray-400">
          Report this campaign
        </button>
      )}
      {reportOpen && <ReportModal campaignId={id} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

function ReportModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [category, setCategory] = useState("FRAUD");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!description.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, description: description.trim() }),
      });
      setSent(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-4 z-50">
      <div className="bg-white rounded-md p-4 w-full max-w-sm space-y-2">
        <h3 className="text-sm font-medium">Report campaign</h3>
        {sent ? (
          <p className="text-sm text-green-700">Thank you — this has been reported for review.</p>
        ) : (
          <>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
              <option value="FRAUD">Suspected fraud</option>
              <option value="SCAM_OR_FINANCIAL">Financial scam</option>
              <option value="INAPPROPRIATE_CONTENT">Inappropriate content</option>
              <option value="OTHER">Other</option>
            </select>
            <textarea placeholder="What's wrong with this campaign?" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full border rounded-md px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 px-3 py-2 text-sm rounded-md border">Cancel</button>
              <button onClick={submit} disabled={saving} className="flex-1 px-3 py-2 text-sm rounded-md bg-red-600 text-white disabled:opacity-50">
                {saving ? "Sending..." : "Submit"}
              </button>
            </div>
          </>
        )}
        {sent && (
          <button onClick={onClose} className="w-full px-3 py-2 text-sm rounded-md border mt-2">Close</button>
        )}
      </div>
    </div>
  );
}
