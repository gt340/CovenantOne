"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "MARRIAGE_SUPPORT", label: "Marriage Support" },
  { value: "EMERGENCY_SUPPORT", label: "Emergency Support" },
  { value: "EDUCATION", label: "Education" },
  { value: "BUSINESS_STARTUP", label: "Business Startup" },
  { value: "FAMILY_EMERGENCY", label: "Family Emergency" },
  { value: "COMMUNITY_PROJECTS", label: "Community Projects" },
];

type Campaign = {
  id: string;
  title: string;
  category: string;
  goalAmountCents: number;
  raisedAmountCents: number;
  status: string;
  deadline: string;
  verificationStatus: string;
  organizerName: string;
};

function money(cents: number) {
  return `GH₵${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FundPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    const res = await fetch(`/api/campaigns?${params.toString()}`, { credentials: "include" });
    if (res.ok) setCampaigns((await res.json()).campaigns ?? []);
    setLoading(false);
  }, [activeCategory]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Community Support Fund</h1>
      <p className="text-sm text-gray-500 mb-1">
        Member-led fundraising for genuine needs — marriage support, emergencies, education, and more.
      </p>
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
        Every campaign is reviewed and verified before it goes live. Donations are handled through a
        real payment provider boundary — if none is configured yet, donations will show as unavailable
        rather than pretending to process.
      </p>

      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={() => setActiveCategory(null)}
          className={`text-xs px-3 py-1.5 rounded-full border ${!activeCategory ? "bg-blue-600 text-white" : ""}`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setActiveCategory(c.value)}
            className={`text-xs px-3 py-1.5 rounded-full border ${activeCategory === c.value ? "bg-blue-600 text-white" : ""}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex gap-3 mb-6">
        <button onClick={() => setShowCreate((s) => !s)} className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white">
          {showCreate ? "Cancel" : "+ Start a Campaign"}
        </button>
        <Link href="/fund/mine" className="text-sm px-4 py-2 rounded-md border">
          My Campaigns
        </Link>
      </div>

      {showCreate && <CreateCampaignForm onCreated={() => { setShowCreate(false); load(); }} />}

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      <div className="space-y-2">
        {!loading && campaigns.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">No active campaigns right now.</div>}
        {campaigns.map((c) => {
          const pct = Math.min(100, Math.round((c.raisedAmountCents / c.goalAmountCents) * 100));
          return (
            <Link key={c.id} href={`/fund/${c.id}`} className="block border rounded-md p-3 hover:bg-gray-50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wide text-gray-400">
                  {CATEGORIES.find((cat) => cat.value === c.category)?.label ?? c.category}
                </span>
                {c.verificationStatus === "VERIFIED" && (
                  <span className="text-[10px] uppercase tracking-wide text-green-600 font-semibold">✓ Verified</span>
                )}
              </div>
              <div className="text-sm font-medium">{c.title}</div>
              <div className="text-xs text-gray-500 mb-2">by {c.organizerName}</div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 mb-1">
                <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-xs text-gray-500">
                {money(c.raisedAmountCents)} raised of {money(c.goalAmountCents)} goal
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function CreateCampaignForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0].value);
  const [goalAmount, setGoalAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryRelationship, setBeneficiaryRelationship] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !description.trim() || !goalAmount || !deadline || !beneficiaryName.trim() || !beneficiaryRelationship.trim()) {
      setError("All fields are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          goalAmount: Number(goalAmount),
          deadline: new Date(deadline).toISOString(),
          beneficiaryName: beneficiaryName.trim(),
          beneficiaryRelationship: beneficiaryRelationship.trim(),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit campaign.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-md p-3 mb-6 space-y-2">
      <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <input type="text" placeholder="Campaign title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <textarea placeholder="Describe the need and purpose in detail" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full border rounded-md px-3 py-2 text-sm" />
      <input type="number" placeholder="Target amount (GHS)" value={goalAmount} onChange={(e) => setGoalAmount(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <label className="block text-xs text-gray-500">Deadline</label>
      <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <input type="text" placeholder="Beneficiary name" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <input type="text" placeholder="Your relationship to the beneficiary (e.g. Self, Spouse)" value={beneficiaryRelationship} onChange={(e) => setBeneficiaryRelationship(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
        {saving ? "Submitting..." : "Submit for Review"}
      </button>
      <p className="text-xs text-gray-400">Only one active campaign is allowed per member at a time.</p>
    </div>
  );
}
