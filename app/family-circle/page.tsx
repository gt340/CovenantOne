"use client";

import { useState, useEffect, useCallback } from "react";

type ConnectionSummary = {
  id: string;
  currentStage: string;
  currentStageLabel: string;
  otherMember: { displayName: string };
};

type Invitation = {
  id: string;
  inviteeName: string;
  inviteeEmail: string | null;
  inviteeRelationship: string;
  accessScope: "VIEW_STAGE_ONLY" | "VIEW_STAGE_AND_SUMMARY";
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED";
  createdAt: string;
};

const EARLY_STAGES = ["DISCOVERY", "INTRODUCED", "FRIENDSHIP", "ENDED"];

export default function FamilyCirclePage() {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/connections", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()).connections ?? [];
        setConnections(data);
        if (data.length) setConnectionId(data[0].id);
      }
      setLoading(false);
    })();
  }, []);

  const loadInvitations = useCallback(async (cid: string) => {
    if (!cid) return;
    const res = await fetch(`/api/family-circle?connectionId=${cid}`, { credentials: "include" });
    if (res.ok) setInvitations((await res.json()).invitations ?? []);
  }, []);

  useEffect(() => {
    loadInvitations(connectionId);
  }, [connectionId, loadInvitations]);

  const selected = connections.find((c) => c.id === connectionId);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Family Circle</h1>
      <p className="text-sm text-gray-500 mb-6">
        Invite trusted family members or mentors into limited visibility of a relationship as it becomes serious.
      </p>

      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}

      {!loading && connections.length === 0 && (
        <div className="text-sm text-gray-400 py-8 text-center">You don&apos;t have any connections yet.</div>
      )}

      {!loading && connections.length > 0 && (
        <>
          <label className="block text-xs text-gray-500 mb-1">Connection</label>
          <select
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm mb-2"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.otherMember.displayName} — {c.currentStageLabel}
              </option>
            ))}
          </select>

          {selected && EARLY_STAGES.includes(selected.currentStage) && (
            <p className="text-xs text-amber-600 mb-4">
              Family/mentor invitations open up once this relationship reaches Discernment or later.
            </p>
          )}

          {error && <div className="text-red-600 text-xs mb-4">{error}</div>}

          <InviteForm connectionId={connectionId} onCreated={() => loadInvitations(connectionId)} setParentError={setError} />

          <div className="space-y-2 mt-6">
            {invitations.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">No invitations yet.</div>}
            {invitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} onChanged={() => loadInvitations(connectionId)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function InviteForm({
  connectionId,
  onCreated,
  setParentError,
}: {
  connectionId: string;
  onCreated: () => void;
  setParentError: (e: string | null) => void;
}) {
  const [inviteeName, setInviteeName] = useState("");
  const [inviteeRelationship, setInviteeRelationship] = useState("");
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [accessScope, setAccessScope] = useState<"VIEW_STAGE_ONLY" | "VIEW_STAGE_AND_SUMMARY">("VIEW_STAGE_ONLY");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!inviteeName.trim() || !inviteeRelationship.trim()) {
      setParentError("Name and relationship are required.");
      return;
    }
    setSaving(true);
    setParentError(null);
    try {
      const res = await fetch("/api/family-circle", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          inviteeName: inviteeName.trim(),
          inviteeRelationship: inviteeRelationship.trim(),
          inviteeEmail: inviteeEmail.trim() || undefined,
          accessScope,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      setInviteeName("");
      setInviteeRelationship("");
      setInviteeEmail("");
      onCreated();
    } catch (err) {
      setParentError(err instanceof Error ? err.message : "Could not create invitation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-md p-3 space-y-2">
      <input
        type="text"
        placeholder="Name (e.g. Pastor James)"
        value={inviteeName}
        onChange={(e) => setInviteeName(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Relationship (e.g. Father, Pastor, Mentor)"
        value={inviteeRelationship}
        onChange={(e) => setInviteeRelationship(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
      <input
        type="email"
        placeholder="Email (optional)"
        value={inviteeEmail}
        onChange={(e) => setInviteeEmail(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
      <select value={accessScope} onChange={(e) => setAccessScope(e.target.value as any)} className="w-full border rounded-md px-3 py-2 text-sm">
        <option value="VIEW_STAGE_ONLY">Access: relationship stage only</option>
        <option value="VIEW_STAGE_AND_SUMMARY">Access: stage plus a short summary</option>
      </select>
      <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
        {saving ? "Inviting..." : "Send Invitation"}
      </button>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "text-amber-600",
  ACCEPTED: "text-green-600",
  DECLINED: "text-gray-400",
  REVOKED: "text-red-500",
};

function InvitationRow({ invitation, onChanged }: { invitation: Invitation; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function setStatus(status: "ACCEPTED" | "DECLINED" | "REVOKED") {
    setBusy(true);
    try {
      const res = await fetch(`/api/family-circle/${invitation.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-md p-3 flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">
          {invitation.inviteeName} <span className="text-xs text-gray-400">· {invitation.inviteeRelationship}</span>
        </div>
        <div className={`text-xs ${STATUS_COLORS[invitation.status]}`}>{invitation.status}</div>
      </div>
      {invitation.status === "PENDING" && (
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => setStatus("ACCEPTED")} className="text-xs px-2 py-1 rounded bg-green-600 text-white disabled:opacity-50">
            Mark Accepted
          </button>
          <button disabled={busy} onClick={() => setStatus("DECLINED")} className="text-xs px-2 py-1 rounded bg-gray-300 disabled:opacity-50">
            Declined
          </button>
          <button disabled={busy} onClick={() => setStatus("REVOKED")} className="text-xs px-2 py-1 rounded bg-red-500 text-white disabled:opacity-50">
            Revoke
          </button>
        </div>
      )}
    </div>
  );
}
