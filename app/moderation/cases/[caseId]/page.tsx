"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type CaseDetail = {
  case: { id: string; status: string; priority: string; createdAt: string; closedAt: string | null };
  report: {
    id: string;
    reporterId: string;
    reportedUserId: string;
    category: string;
    description: string;
    status: string;
    createdAt: string;
  } | null;
  actions: { id: string; moderatorId: string; actionType: string; notes: string | null; createdAt: string }[];
};

type Evidence = { id: string; addedByUserId: string; evidenceType: string; referenceId: string | null; description: string | null; createdAt: string };
type Note = { id: string; moderatorId: string; note: string; createdAt: string };
type ConversationMessage = { id: string; senderId: string; type: string; content: string; deleted: boolean; createdAt: string };

const ACTION_TYPES = [
  "WARNING_ISSUED",
  "CONTENT_REMOVED",
  "ACCOUNT_SUSPENDED",
  "ACCOUNT_BANNED",
  "ACCOUNT_REINSTATED",
  "CASE_ESCALATED",
  "CASE_CLOSED",
  "NO_ACTION_TAKEN",
];

export default function ModerationCaseDetailPage() {
  const params = useParams();
  const caseId = params?.caseId as string;

  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "evidence" | "notes" | "conversation">("overview");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/moderation/cases/${caseId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setDetail(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load case.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (caseId) load();
  }, [caseId, load]);

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-400">Loading...</div>;
  if (error || !detail) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3">
          {error ?? "Case not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-24">
      <Link href="/moderation/queue" className="text-sm text-blue-600 mb-3 inline-block">
        ← Back to Queue
      </Link>

      <h1 className="text-xl font-semibold mb-1">{detail.report?.category ?? "Case"}</h1>
      <div className="text-sm text-gray-500 mb-4">
        {detail.case.status} · {detail.case.priority} priority · opened{" "}
        {new Date(detail.case.createdAt).toLocaleString()}
      </div>

      <div className="border rounded-md p-4 bg-gray-50 mb-4">
        <p className="text-sm text-gray-700 mb-2">{detail.report?.description}</p>
        <div className="text-xs text-gray-500">
          Reported user: {detail.report?.reportedUserId} · Reporter: {detail.report?.reporterId}
        </div>
      </div>

      <div className="flex gap-2 mb-4 border-b overflow-x-auto">
        {(["overview", "evidence", "notes", "conversation"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px capitalize whitespace-nowrap ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab caseId={caseId} detail={detail} onActionTaken={load} />}
      {tab === "evidence" && <EvidenceTab caseId={caseId} />}
      {tab === "notes" && <NotesTab caseId={caseId} />}
      {tab === "conversation" && <ConversationTab caseId={caseId} />}
    </div>
  );
}

function OverviewTab({ caseId, detail, onActionTaken }: { caseId: string; detail: CaseDetail; onActionTaken: () => void }) {
  const [actionType, setActionType] = useState(ACTION_TYPES[0]);
  const [notes, setNotes] = useState("");
  const [suspensionDays, setSuspensionDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/moderation/cases/${caseId}/actions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          notes: notes.trim() || undefined,
          suspensionDays: actionType === "ACCOUNT_SUSPENDED" ? suspensionDays : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setNotes("");
      onActionTaken();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record action.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Action history</h2>
      <div className="space-y-2 mb-6">
        {detail.actions.length === 0 && <div className="text-sm text-gray-400">No actions taken yet.</div>}
        {detail.actions.map((a) => (
          <div key={a.id} className="border rounded-md p-3 text-sm">
            <div className="font-medium">{a.actionType.replace(/_/g, " ")}</div>
            {a.notes && <div className="text-gray-600 mt-1">{a.notes}</div>}
            <div className="text-xs text-gray-400 mt-1">{new Date(a.createdAt).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-semibold text-gray-700 mb-2">Take action</h2>
      <div className="border rounded-md p-4 space-y-3">
        <select value={actionType} onChange={(e) => setActionType(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
          {ACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        {actionType === "ACCOUNT_SUSPENDED" && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Suspension length (days)</label>
            <input
              type="number"
              min={1}
              value={suspensionDays}
              onChange={(e) => setSuspensionDays(Number(e.target.value))}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
        )}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes for this action (optional)"
          rows={3}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        {error && <div className="text-red-600 text-xs">{error}</div>}
        <button
          onClick={submit}
          disabled={submitting}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
        >
          {submitting ? "Recording..." : "Record Action"}
        </button>
      </div>
    </div>
  );
}

function EvidenceTab({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("MESSAGE_REFERENCE");
  const [referenceId, setReferenceId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/moderation/cases/${caseId}/evidence`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setItems(data.evidence ?? []);
    }
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!description.trim() && !referenceId.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/moderation/cases/${caseId}/evidence`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceType: type, referenceId: referenceId.trim() || undefined, description: description.trim() || undefined }),
      });
      setReferenceId("");
      setDescription("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-center text-gray-400 py-8">Loading...</div>;

  return (
    <div>
      <div className="space-y-2 mb-4">
        {items.length === 0 && <div className="text-sm text-gray-400">No evidence recorded yet.</div>}
        {items.map((e) => (
          <div key={e.id} className="border rounded-md p-3 text-sm">
            <div className="font-medium">{e.evidenceType.replace(/_/g, " ")}</div>
            {e.referenceId && <div className="text-xs text-gray-500">Reference: {e.referenceId}</div>}
            {e.description && <div className="text-gray-600 mt-1">{e.description}</div>}
            <div className="text-xs text-gray-400 mt-1">{new Date(e.createdAt).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="border rounded-md p-4 space-y-3">
        <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
          <option value="MESSAGE_REFERENCE">Message reference</option>
          <option value="VOICE_MESSAGE_REFERENCE">Voice message reference</option>
          <option value="PROFILE_SNAPSHOT">Profile snapshot</option>
          <option value="SCREENSHOT_DESCRIPTION">Screenshot description</option>
          <option value="OTHER">Other</option>
        </select>
        <input
          type="text"
          placeholder="Reference ID (e.g. a message id, optional)"
          value={referenceId}
          onChange={(e) => setReferenceId(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={submit} disabled={submitting} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white disabled:opacity-50">
          Add Evidence
        </button>
      </div>
    </div>
  );
}

function NotesTab({ caseId }: { caseId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/moderation/cases/${caseId}/notes`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setNotes(data.notes ?? []);
    }
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/moderation/cases/${caseId}/notes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: draft.trim() }),
      });
      setDraft("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-center text-gray-400 py-8">Loading...</div>;

  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">Visible to moderators only — not part of the formal action record.</p>
      <div className="space-y-2 mb-4">
        {notes.length === 0 && <div className="text-sm text-gray-400">No notes yet.</div>}
        {notes.map((n) => (
          <div key={n.id} className="border rounded-md p-3 text-sm">
            <div className="text-gray-700">{n.note}</div>
            <div className="text-xs text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a working note..."
          rows={2}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={submit} disabled={submitting} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white disabled:opacity-50 self-start">
          Add
        </button>
      </div>
    </div>
  );
}

function ConversationTab({ caseId }: { caseId: string }) {
  const [reason, setReason] = useState("");
  const [conversations, setConversations] = useState<{ conversationId: string; messages: ConversationMessage[] }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchConversation() {
    if (!reason.trim()) {
      setError("A reason is required before accessing conversation content — this is logged to the audit trail.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/moderation/cases/${caseId}/conversation?reason=${encodeURIComponent(reason.trim())}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setConversations(data.conversations ?? []);
      if ((data.conversations ?? []).length === 0) {
        setError("No conversation content is accessible for this case — either none exists, or you aren't the assigned moderator on an open case for it.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conversation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="border border-amber-200 bg-amber-50 rounded-md p-3 mb-4 text-xs text-amber-800">
        Every access to private conversation content is logged with your identity, the reason you give, and a
        timestamp. Only use this when genuinely investigating this case.
      </div>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Reason for accessing this conversation (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button
          onClick={fetchConversation}
          disabled={loading}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
        >
          {loading ? "Loading..." : "Access"}
        </button>
      </div>
      {error && <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">{error}</div>}
      {conversations?.map((c) => (
        <div key={c.conversationId} className="space-y-2 mb-4">
          {c.messages.map((m) => (
            <div key={m.id} className="border rounded-md p-2 text-sm">
              <div className="text-xs text-gray-400">
                {m.senderId} · {m.type} · {new Date(m.createdAt).toLocaleString()}
              </div>
              <div className={m.deleted ? "italic text-gray-400" : ""}>{m.content || (m.type === "VOICE" ? "[voice message]" : "")}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
