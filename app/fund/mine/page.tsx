"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Campaign = {
  id: string;
  title: string;
  category: string;
  goalAmountCents: number;
  raisedAmountCents: number;
  status: string;
  verificationStatus: string;
};

function money(cents: number) {
  return `GH₵${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_COLOR: Record<string, string> = {
  SUBMITTED: "bg-yellow-50 text-yellow-700",
  UNDER_REVIEW: "bg-yellow-50 text-yellow-700",
  APPROVED: "bg-blue-50 text-blue-700",
  ACTIVE: "bg-green-50 text-green-700",
  COMPLETED: "bg-blue-50 text-blue-700",
  DISBURSED: "bg-gray-100 text-gray-600",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-500",
};

export default function MyCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/campaigns?mine=true", { credentials: "include" });
    if (res.ok) setCampaigns((await res.json()).campaigns ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/fund" className="text-sm text-blue-600 mb-3 inline-block">← Back to Community Support Fund</Link>
      <h1 className="text-2xl font-semibold mb-6">My Campaigns</h1>

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      <div className="space-y-2">
        {!loading && campaigns.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">You haven't started a campaign yet.</div>}
        {campaigns.map((c) => (
          <Link key={c.id} href={`/fund/${c.id}`} className="block border rounded-md p-3 hover:bg-gray-50">
            <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full ${STATUS_COLOR[c.status] ?? "bg-gray-100"}`}>{c.status}</span>
            <div className="text-sm font-medium mt-1">{c.title}</div>
            <div className="text-xs text-gray-500">
              {money(c.raisedAmountCents)} raised of {money(c.goalAmountCents)} goal · Verification: {c.verificationStatus}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
