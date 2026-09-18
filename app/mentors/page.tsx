"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Mentor = {
  id: string;
  userId: string;
  role: string;
  bio: string | null;
  specialties: string[];
  capacity: number;
  isActive: boolean;
  displayName: string;
  headlinePhotoUrl: string | null;
};

type MentorshipRequest = {
  id: string;
  menteeId: string;
  mentorId: string;
  status: string;
  message: string | null;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  MARRIAGE_MENTOR: "Marriage Mentor",
  FAMILY_MENTOR: "Family Mentor",
  BUSINESS_MENTOR: "Business Mentor",
  FINANCIAL_MENTOR: "Financial Mentor",
};

type Tab = "directory" | "my-requests" | "mentor-dashboard";

export default function MentorsPage() {
  const [tab, setTab] = useState<Tab>("directory");

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Mentors</h1>
        <Link href="/guidance" className="text-sm text-blue-600">
          Guidance Center →
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Find a mentor, or manage your own mentorship relationships.</p>

      <div className="flex gap-2 mb-6 border-b overflow-x-auto">
        {(["directory", "my-requests", "mentor-dashboard"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
            }`}
          >
            {t === "directory" ? "Find a Mentor" : t === "my-requests" ? "My Requests" : "Mentor Dashboard"}
          </button>
        ))}
      </div>

      {tab === "directory" && <DirectoryTab />}
      {tab === "my-requests" && <MyRequestsTab />}
      {tab === "mentor-dashboard" && <MentorDashboardTab />}
    </div>
  );
}

function DirectoryTab() {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [requestTarget, setRequestTarget] = useState<Mentor | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set("role", roleFilter);
      const res = await fetch(`/api/mentors?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setMentors(data.mentors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mentors.");
    } finally {
      setLoading(false);
    }
  }, [roleFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendRequest() {
    if (!requestTarget) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/mentorship-requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentorId: requestTarget.id, message: message.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setSentIds((prev) => new Set(prev).add(requestTarget.id));
      setRequestTarget(null);
      setMessage("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send request.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <select
        value={roleFilter}
        onChange={(e) => setRoleFilter(e.target.value)}
        className="border rounded-md px-3 py-2 text-sm mb-4"
      >
        <option value="">All mentor types</option>
        {Object.entries(ROLE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>

      {error && <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">{error}</div>}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      {!loading && mentors.length === 0 && <div className="text-center text-gray-400 py-12">No mentors available right now.</div>}

      <div className="space-y-3">
        {mentors.map((m) => (
          <div key={m.id} className="border rounded-lg p-4 bg-white flex gap-3">
            <div className="w-14 h-14 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
              {m.headlinePhotoUrl ? (
                <img src={m.headlinePhotoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">{m.displayName[0]}</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium">{m.displayName}</div>
              <div className="text-xs text-blue-600 mb-1">{ROLE_LABELS[m.role] ?? m.role}</div>
              {m.bio && <p className="text-sm text-gray-600 line-clamp-2">{m.bio}</p>}
              {m.specialties?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {m.specialties.map((s) => (
                    <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => setRequestTarget(m)}
                disabled={sentIds.has(m.id)}
                className="mt-2 text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
              >
                {sentIds.has(m.id) ? "Request Sent" : "Request Mentorship"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {requestTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-lg max-w-sm w-full p-5">
            <h2 className="font-semibold mb-1">Request {requestTarget.displayName} as a mentor</h2>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Briefly share what you're hoping for (optional)"
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm my-3"
            />
            {sendError && <div className="text-red-600 text-xs mb-2">{sendError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setRequestTarget(null)} disabled={sending} className="px-3 py-1.5 text-sm rounded-md border">
                Cancel
              </button>
              <button
                onClick={sendRequest}
                disabled={sending}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MyRequestsTab() {
  const [requests, setRequests] = useState<MentorshipRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/mentorship-requests?as=mentee", { credentials: "include" });
    if (res.ok) setRequests((await res.json()).requests ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function withdraw(id: string) {
    setActingOn(id);
    try {
      await fetch(`/api/mentorship-requests/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      await load();
    } finally {
      setActingOn(null);
    }
  }

  const statusColor: Record<string, string> = {
    PENDING: "bg-yellow-50 text-yellow-700",
    ACCEPTED: "bg-green-50 text-green-700",
    DECLINED: "bg-gray-100 text-gray-500",
    WITHDRAWN: "bg-gray-100 text-gray-500",
    COMPLETED: "bg-blue-50 text-blue-600",
  };

  if (loading) return <div className="text-center text-gray-400 py-12">Loading...</div>;
  if (requests.length === 0) return <div className="text-center text-gray-400 py-12">You haven't requested a mentor yet.</div>;

  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <div key={r.id} className="border rounded-lg p-4 bg-white">
          <div className="flex justify-between items-start mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[r.status] ?? "bg-gray-100"}`}>{r.status}</span>
            <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</span>
          </div>
          {r.message && <p className="text-sm text-gray-600 mb-2">{r.message}</p>}
          {r.status === "ACCEPTED" && (
            <Link href={`/mentors/requests/${r.id}`} className="text-xs text-blue-600 underline">
              Open mentorship →
            </Link>
          )}
          {r.status === "PENDING" && (
            <button onClick={() => withdraw(r.id)} disabled={actingOn === r.id} className="text-xs text-gray-400 underline">
              Withdraw
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function MentorDashboardTab() {
  const [myProfile, setMyProfile] = useState<Mentor | null>(null);
  const [received, setReceived] = useState<MentorshipRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState("MARRIAGE_MENTOR");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const mineRes = await fetch("/api/mentors?mine=true", { credentials: "include" });
    if (mineRes.ok) {
      const data = await mineRes.json();
      const mine = (data.mentors ?? [])[0] ?? null;
      setMyProfile(mine);
      if (mine) {
        const reqRes = await fetch("/api/mentorship-requests?as=mentor", { credentials: "include" });
        if (reqRes.ok) setReceived((await reqRes.json()).requests ?? []);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitProfile() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/mentors", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, bio: bio.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  }

  async function respond(id: string, action: "accept" | "decline") {
    setActingOn(id);
    try {
      await fetch(`/api/mentorship-requests/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setActingOn(null);
    }
  }

  if (loading) return <div className="text-center text-gray-400 py-12">Loading...</div>;

  if (!myProfile) {
    return (
      <div>
        <p className="text-sm text-gray-600 mb-4">
          You don't have a mentor profile yet. Applying doesn't make you visible immediately — an admin
          reviews and approves every mentor profile before it's listed.
        </p>
        {!showForm ? (
          <button onClick={() => setShowForm(true)} className="text-sm text-blue-600">
            + Apply to become a mentor
          </button>
        ) : (
          <div className="border rounded-md p-4 space-y-3">
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A short bio about your experience and approach"
              rows={4}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            {submitError && <div className="text-red-600 text-xs">{submitError}</div>}
            <button
              onClick={submitProfile}
              disabled={submitting}
              className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="border rounded-md p-4 bg-gray-50 mb-6">
        <div className="font-medium">{ROLE_LABELS[myProfile.role] ?? myProfile.role}</div>
        <div className="text-xs text-gray-500 mt-1">
          {myProfile.isActive ? "Active — visible to members" : "Pending admin approval"}
        </div>
      </div>

      <h2 className="text-sm font-semibold text-gray-700 mb-2">Received requests</h2>
      {received.length === 0 && <div className="text-sm text-gray-400">None yet.</div>}
      <div className="space-y-2">
        {received.map((r) => (
          <div key={r.id} className="border rounded-md p-3">
            <div className="flex justify-between items-start mb-1">
              <span className="text-xs text-gray-500">{r.status}</span>
              <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
            {r.message && <p className="text-sm text-gray-600 mb-2">{r.message}</p>}
            {r.status === "PENDING" && (
              <div className="flex gap-2">
                <button
                  onClick={() => respond(r.id, "accept")}
                  disabled={actingOn === r.id}
                  className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  onClick={() => respond(r.id, "decline")}
                  disabled={actingOn === r.id}
                  className="text-xs px-3 py-1.5 rounded-md border disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            )}
            {r.status === "ACCEPTED" && (
              <Link href={`/mentors/requests/${r.id}`} className="text-xs text-blue-600 underline">
                Open mentorship →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
