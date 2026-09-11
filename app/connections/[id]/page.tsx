"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type StageData = {
  connection: {
    id: string;
    status: string;
    currentStage: string;
    currentStageLabel: string;
    pendingStage: string | null;
    pendingStageLabel: string | null;
    proposedByMe: boolean;
    createdAt: string;
  };
  otherMember: { id: string; displayName: string; headlinePhotoUrl: string | null };
  guidance: {
    summary: string;
    topics: { title: string; prompts: string[] }[];
    advancingNote: string;
  } | null;
  nextStage: string | null;
  nextStageLabel: string | null;
  history: { stage: string; notes: string | null; enteredAt: string }[];
  meetingSafetyGuidance: { title: string; points: string[] };
};

type Message = {
  id: string;
  senderId: string;
  isMine: boolean;
  content: string;
  readAt: string | null;
  createdAt: string;
};

type MentorInvite = {
  id: string;
  inviteeName: string;
  inviteeRelationship: string;
  accessScope: string;
  status: string;
  createdAt: string;
};

type Tab = "journey" | "messages" | "mentors";

export default function ConnectionJourneyPage() {
  const params = useParams();
  const connectionId = params?.id as string;

  const [tab, setTab] = useState<Tab>("journey");
  const [data, setData] = useState<StageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSafety, setShowSafety] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const loadStage = useCallback(async () => {
    try {
      const res = await fetch(`/api/connections/${connectionId}/stage`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const d: StageData = await res.json();
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this connection.");
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    if (connectionId) loadStage();
  }, [connectionId, loadStage]);

  async function doStageAction(action: "propose" | "confirm" | "cancel" | "end") {
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}/stage`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await loadStage();
      setShowEndConfirm(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not complete that action.");
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-12 text-center text-gray-400">Loading...</div>;
  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3">
          {error ?? "Connection not found."}
        </div>
        <Link href="/connections" className="text-sm text-blue-600 mt-4 inline-block">
          ← Back to Connections
        </Link>
      </div>
    );
  }

  const { connection, otherMember, guidance, nextStageLabel, meetingSafetyGuidance } = data;
  const isEnded = connection.status !== "ACTIVE";

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
      <Link href="/connections" className="text-sm text-blue-600 mb-3 inline-block">
        ← Back to Connections
      </Link>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-14 h-14 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
          {otherMember.headlinePhotoUrl ? (
            <img src={otherMember.headlinePhotoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">
              {otherMember.displayName?.[0] ?? "?"}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold">{otherMember.displayName}</h1>
          <div className="text-sm text-gray-500">
            {isEnded ? "Connection ended" : connection.currentStageLabel}
          </div>
        </div>
      </div>

      <button
        onClick={() => setShowSafety((s) => !s)}
        className="w-full text-left text-sm border border-amber-200 bg-amber-50 text-amber-800 rounded-md px-3 py-2 mb-4"
      >
        🛡 {meetingSafetyGuidance.title} — tap for safety tips before meeting in person
      </button>
      {showSafety && (
        <ul className="text-xs text-amber-800 bg-amber-50 border border-t-0 border-amber-200 rounded-b-md -mt-4 mb-4 px-6 py-3 list-disc space-y-1">
          {meetingSafetyGuidance.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 mb-4 border-b">
        {(["journey", "messages", "mentors"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px capitalize ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">
          {actionError}
        </div>
      )}

      {tab === "journey" && (
        <div>
          {!isEnded && guidance && (
            <>
              <p className="text-sm text-gray-600 mb-4">{guidance.summary}</p>

              {connection.pendingStage ? (
                <div className="border border-blue-200 bg-blue-50 rounded-md p-4 mb-5">
                  <p className="text-sm text-blue-800 mb-2">
                    {connection.proposedByMe
                      ? `You proposed moving to ${connection.pendingStageLabel}. Waiting for ${otherMember.displayName} to confirm.`
                      : `${otherMember.displayName} proposed moving to ${connection.pendingStageLabel}.`}
                  </p>
                  <div className="flex gap-2">
                    {!connection.proposedByMe && (
                      <button
                        onClick={() => doStageAction("confirm")}
                        disabled={actionBusy}
                        className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    )}
                    <button
                      onClick={() => doStageAction("cancel")}
                      disabled={actionBusy}
                      className="text-xs px-3 py-1.5 rounded-md border disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                nextStageLabel && (
                  <div className="border rounded-md p-4 mb-5 bg-gray-50">
                    <p className="text-sm text-gray-600 mb-2">{guidance.advancingNote}</p>
                    <button
                      onClick={() => doStageAction("propose")}
                      disabled={actionBusy}
                      className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
                    >
                      Propose moving to {nextStageLabel}
                    </button>
                  </div>
                )
              )}

              {guidance.topics.length > 0 && (
                <div className="space-y-4 mb-6">
                  <h2 className="text-sm font-semibold text-gray-700">Things to explore together</h2>
                  {guidance.topics.map((t) => (
                    <div key={t.title}>
                      <div className="text-sm font-medium text-gray-700 mb-1">{t.title}</div>
                      <ul className="text-sm text-gray-600 list-disc pl-5 space-y-0.5">
                        {t.prompts.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Journey history</h2>
            <div className="space-y-1">
              {data.history.map((h, i) => (
                <div key={i} className="text-xs text-gray-500">
                  {new Date(h.enteredAt).toLocaleDateString()} — entered {h.stage}
                </div>
              ))}
            </div>
          </div>

          {!isEnded && (
            <div className="border-t pt-4">
              {!showEndConfirm ? (
                <button onClick={() => setShowEndConfirm(true)} className="text-xs text-gray-400 underline">
                  End this connection
                </button>
              ) : (
                <div className="border rounded-md p-3 bg-gray-50">
                  <p className="text-xs text-gray-600 mb-2">
                    Ending is always okay — no explanation is required, and there's no penalty for either of
                    you. This step can't be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => doStageAction("end")}
                      disabled={actionBusy}
                      className="text-xs px-3 py-1.5 rounded-md bg-red-600 text-white disabled:opacity-50"
                    >
                      Yes, end connection
                    </button>
                    <button onClick={() => setShowEndConfirm(false)} className="text-xs px-3 py-1.5 rounded-md border">
                      Never mind
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "messages" && <MessagesTab connectionId={connectionId} disabled={isEnded} />}
      {tab === "mentors" && <MentorsTab connectionId={connectionId} otherMemberName={otherMember.displayName} />}
    </div>
  );
}

function MessagesTab({ connectionId, disabled }: { connectionId: string; disabled: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/connections/${connectionId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages.");
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const newMsg: Message = await res.json();
      setMessages((prev) => [...prev, newMsg]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="text-center text-gray-400 py-12">Loading messages...</div>;

  return (
    <div className="flex flex-col" style={{ minHeight: "50vh" }}>
      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-3">
          {error}
        </div>
      )}
      <div className="flex-1 space-y-2 mb-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 py-8 text-sm">No messages yet — say hello.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.isMine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                m.isMine ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
              }`}
            >
              {m.content}
              <div className={`text-[10px] mt-1 ${m.isMine ? "text-blue-100" : "text-gray-400"}`}>
                {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {disabled ? (
        <div className="text-xs text-gray-400 text-center border-t pt-3">
          This connection has ended — message history is kept but new messages can't be sent.
        </div>
      ) : (
        <div className="flex gap-2 border-t pt-3">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Type a message..."
            className="flex-1 border rounded-md px-3 py-2 text-sm"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

function MentorsTab({ connectionId, otherMemberName }: { connectionId: string; otherMemberName: string }) {
  const [invites, setInvites] = useState<MentorInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [email, setEmail] = useState("");
  const [accessScope, setAccessScope] = useState<"VIEW_STAGE_ONLY" | "VIEW_STAGE_AND_SUMMARY">("VIEW_STAGE_ONLY");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/connections/${connectionId}/mentors`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setInvites(data.invitations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invitations.");
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!name.trim() || !relationship.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}/mentors`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteeName: name.trim(),
          inviteeRelationship: relationship.trim(),
          inviteeEmail: email.trim() || undefined,
          accessScope,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setName("");
      setRelationship("");
      setEmail("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    try {
      await fetch(`/api/connections/${connectionId}/mentors/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      await load();
    } catch {
      // best effort
    }
  }

  if (loading) return <div className="text-center text-gray-400 py-8">Loading...</div>;

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Bring trusted family members or mentors into your journey with {otherMemberName}, with a scope you
        choose — either just seeing your current stage, or the stage plus a brief summary.
      </p>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-3">
          {error}
        </div>
      )}

      <div className="space-y-2 mb-4">
        {invites.length === 0 && <div className="text-sm text-gray-400">No one invited yet.</div>}
        {invites.map((inv) => (
          <div key={inv.id} className="border rounded-md p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{inv.inviteeName}</div>
              <div className="text-xs text-gray-500">
                {inv.inviteeRelationship} · {inv.accessScope === "VIEW_STAGE_ONLY" ? "Stage only" : "Stage + summary"} ·{" "}
                {inv.status}
              </div>
            </div>
            {inv.status === "PENDING" && (
              <button onClick={() => revoke(inv.id)} className="text-xs text-gray-400 underline">
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="text-sm text-blue-600">
          + Invite someone
        </button>
      ) : (
        <div className="border rounded-md p-4 space-y-3">
          <input
            type="text"
            placeholder="Their name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Relationship to you (e.g. Mother, Pastor, Mentor)"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            type="email"
            placeholder="Their email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <select
            value={accessScope}
            onChange={(e) => setAccessScope(e.target.value as any)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            <option value="VIEW_STAGE_ONLY">They can see: current stage only</option>
            <option value="VIEW_STAGE_AND_SUMMARY">They can see: current stage + a brief summary</option>
          </select>
          <p className="text-xs text-gray-400">
            This records your intent — there's no automated email yet, so let them know directly.
          </p>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={submitting || !name.trim() || !relationship.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
            >
              {submitting ? "Adding..." : "Add"}
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 rounded-md border">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
