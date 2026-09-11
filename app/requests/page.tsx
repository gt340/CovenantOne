"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type IntroRequest = {
  id: string;
  direction: "sent" | "received";
  status: string;
  introMessage: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  otherMember: { id: string; displayName: string; headlinePhotoUrl: string | null };
};

type Tab = "received" | "sent";

export default function RequestsPage() {
  const [tab, setTab] = useState<Tab>("received");
  const [requests, setRequests] = useState<IntroRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmBlockFor, setConfirmBlockFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/introductions?direction=${tab}`, { credentials: "include" });
      if (res.status === 401) {
        setError("Please sign in to view your requests.");
        setRequests([]);
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load requests.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(id: string, action: "accept" | "decline" | "not_now" | "withdraw" | "block") {
    setActingOn(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/introductions/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setConfirmBlockFor(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update request.");
    } finally {
      setActingOn(null);
    }
  }

  const statusColor: Record<string, string> = {
    PENDING: "bg-yellow-50 text-yellow-700",
    ACCEPTED: "bg-green-50 text-green-700",
    DECLINED: "bg-gray-100 text-gray-500",
    NOT_NOW: "bg-gray-100 text-gray-500",
    WITHDRAWN: "bg-gray-100 text-gray-500",
    EXPIRED: "bg-gray-100 text-gray-500",
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Friendship Requests</h1>
      <p className="text-sm text-gray-500 mb-6">
        A request must be accepted before a conversation can begin.
      </p>

      <div className="flex gap-2 mb-4 border-b">
        {(["received", "sent"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
            }`}
          >
            {t === "received" ? "Received" : "Sent"}
          </button>
        ))}
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}
      {actionError && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">
          {actionError}
        </div>
      )}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      {!loading && !error && requests.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          {tab === "received" ? "No requests received yet." : "You haven't sent any requests yet."}
        </div>
      )}

      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="border rounded-lg p-4 bg-white">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                {r.otherMember.headlinePhotoUrl ? (
                  <img src={r.otherMember.headlinePhotoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    {r.otherMember.displayName?.[0] ?? "?"}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/discover/${r.otherMember.id}`} className="font-medium hover:underline truncate">
                    {r.otherMember.displayName}
                  </Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${statusColor[r.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {r.status.replace("_", " ")}
                  </span>
                </div>
                {r.introMessage && <p className="text-sm text-gray-600 mt-1">{r.introMessage}</p>}
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>

                {r.status === "PENDING" && tab === "received" && confirmBlockFor !== r.id && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={() => respond(r.id, "accept")}
                      disabled={actingOn === r.id}
                      className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => respond(r.id, "not_now")}
                      disabled={actingOn === r.id}
                      className="text-xs px-3 py-1.5 rounded-md border disabled:opacity-50"
                    >
                      Not now
                    </button>
                    <button
                      onClick={() => respond(r.id, "decline")}
                      disabled={actingOn === r.id}
                      className="text-xs px-3 py-1.5 rounded-md border disabled:opacity-50"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => setConfirmBlockFor(r.id)}
                      disabled={actingOn === r.id}
                      className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-600 disabled:opacity-50"
                    >
                      Block
                    </button>
                  </div>
                )}
                {r.status === "PENDING" && tab === "received" && confirmBlockFor === r.id && (
                  <div className="mt-3 border border-red-200 bg-red-50 rounded-md p-3">
                    <p className="text-xs text-red-700 mb-2">
                      Blocking {r.otherMember.displayName} will decline this request and prevent them from
                      contacting you again. This can be undone later from your blocked list.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => respond(r.id, "block")}
                        disabled={actingOn === r.id}
                        className="text-xs px-3 py-1.5 rounded-md bg-red-600 text-white disabled:opacity-50"
                      >
                        Yes, block
                      </button>
                      <button
                        onClick={() => setConfirmBlockFor(null)}
                        className="text-xs px-3 py-1.5 rounded-md border"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {r.status === "PENDING" && tab === "sent" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => respond(r.id, "withdraw")}
                      disabled={actingOn === r.id}
                      className="text-xs px-3 py-1.5 rounded-md border disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  </div>
                )}
                {r.status === "ACCEPTED" && (
                  <Link
                    href="/connections"
                    className="inline-block mt-3 text-xs px-3 py-1.5 rounded-md bg-green-600 text-white"
                  >
                    View connection
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
