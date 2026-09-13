"use client";

import { useState, useEffect, useCallback } from "react";

type Notification = {
  id: string;
  type: string;
  payload: { actionType?: string; caseId?: string; notes?: string; decision?: string; reviewNotes?: string };
  createdAt: string;
};

type Appeal = { id: string; caseId: string; reason: string; status: string; reviewNotes: string | null; createdAt: string; reviewedAt: string | null };

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-yellow-50 text-yellow-700",
  UNDER_REVIEW: "bg-yellow-50 text-yellow-700",
  GRANTED: "bg-green-50 text-green-700",
  DENIED: "bg-gray-100 text-gray-500",
};

export default function MyAppealsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nRes, aRes] = await Promise.all([
        fetch("/api/notifications?type=MODERATION_UPDATE", { credentials: "include" }),
        fetch("/api/appeals", { credentials: "include" }),
      ]);
      if (nRes.ok) setNotifications((await nRes.json()).notifications ?? []);
      if (aRes.ok) setAppeals((await aRes.json()).appeals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!caseId.trim() || !reason.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/appeals", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: caseId.trim(), reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setCaseId("");
      setReason("");
      setShowForm(false);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit appeal.");
    } finally {
      setSubmitting(false);
    }
  }

  const actionNotifications = notifications.filter((n) => n.payload?.actionType);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Moderation & Appeals</h1>
      <p className="text-sm text-gray-500 mb-6">
        Actions taken on your account, and any appeals you've submitted.
      </p>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">{error}</div>
      )}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}

      {!loading && (
        <>
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Actions on your account</h2>
            {actionNotifications.length === 0 && <div className="text-sm text-gray-400">None.</div>}
            <div className="space-y-2">
              {actionNotifications.map((n) => (
                <div key={n.id} className="border rounded-md p-3">
                  <div className="text-sm font-medium">{n.payload.actionType?.replace(/_/g, " ")}</div>
                  {n.payload.notes && <div className="text-sm text-gray-600 mt-1">{n.payload.notes}</div>}
                  <div className="text-xs text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString()}</div>
                  {n.payload.caseId && (
                    <button
                      onClick={() => {
                        setCaseId(n.payload.caseId!);
                        setShowForm(true);
                      }}
                      className="text-xs text-blue-600 underline mt-1"
                    >
                      Appeal this
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Your appeals</h2>
            {appeals.length === 0 && <div className="text-sm text-gray-400">You haven't submitted any appeals.</div>}
            <div className="space-y-2">
              {appeals.map((a) => (
                <div key={a.id} className="border rounded-md p-3">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm text-gray-700">{a.reason}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[a.status] ?? "bg-gray-100"}`}>
                      {a.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  {a.reviewNotes && <div className="text-xs text-gray-500 mt-1">Review notes: {a.reviewNotes}</div>}
                  <div className="text-xs text-gray-400 mt-1">{new Date(a.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </section>

          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="text-sm text-blue-600">
              + Submit an appeal
            </button>
          ) : (
            <div className="border rounded-md p-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Case ID</label>
                <input
                  type="text"
                  value={caseId}
                  onChange={(e) => setCaseId(e.target.value)}
                  placeholder="From the notification above"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why do you believe this action should be reconsidered?"
                rows={4}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              {submitError && <div className="text-red-600 text-xs">{submitError}</div>}
              <div className="flex gap-2">
                <button
                  onClick={submit}
                  disabled={submitting || !caseId.trim() || !reason.trim()}
                  className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Submit Appeal"}
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-md border">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
