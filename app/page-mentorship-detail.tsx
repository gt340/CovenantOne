"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Session = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  summary: string | null;
};

type Note = { id: string; note: string; createdAt: string };

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: "bg-blue-50 text-blue-600",
  COMPLETED: "bg-green-50 text-green-700",
  CANCELLED: "bg-gray-100 text-gray-500",
  NO_SHOW: "bg-red-50 text-red-600",
};

export default function MentorshipDetailPage() {
  const params = useParams();
  const mentorshipRequestId = params?.id as string;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMentor, setIsMentor] = useState(false);

  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState(45);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/mentorship-requests/${mentorshipRequestId}/sessions`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }, [mentorshipRequestId]);

  useEffect(() => {
    if (mentorshipRequestId) load();
  }, [mentorshipRequestId, load]);

  async function scheduleSession() {
    if (!scheduledAt) return;
    setScheduling(true);
    setScheduleError(null);
    try {
      const res = await fetch(`/api/mentorship-requests/${mentorshipRequestId}/sessions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: new Date(scheduledAt).toISOString(), durationMinutes: duration }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setIsMentor(true);
      setShowSchedule(false);
      setScheduledAt("");
      await load();
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Could not schedule session.");
    } finally {
      setScheduling(false);
    }
  }

  async function updateSessionStatus(sessionId: string, status: string) {
    await fetch(`/api/mentor-sessions/${sessionId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/mentors" className="text-sm text-blue-600 mb-3 inline-block">
        ← Back to Mentors
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Mentorship Sessions</h1>
      <p className="text-sm text-gray-500 mb-6">Session history for this mentorship.</p>

      {error && <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">{error}</div>}
      {scheduleError && <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">{scheduleError}</div>}

      {!showSchedule ? (
        <button onClick={() => setShowSchedule(true)} className="text-sm text-blue-600 mb-6">
          + Schedule a session
        </button>
      ) : (
        <div className="border rounded-md p-4 space-y-3 mb-6">
          <p className="text-xs text-gray-400">Only the mentor can schedule — if you're the mentee, this will simply fail silently below.</p>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            placeholder="Duration (minutes)"
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={scheduleSession} disabled={scheduling} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
              {scheduling ? "Scheduling..." : "Schedule"}
            </button>
            <button onClick={() => setShowSchedule(false)} className="px-4 py-2 text-sm rounded-md border">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-center text-gray-400 py-8">Loading...</div>}
      {!loading && sessions.length === 0 && <div className="text-center text-gray-400 py-8">No sessions yet.</div>}

      <div className="space-y-3">
        {sessions.map((s) => (
          <div key={s.id} className="border rounded-lg p-4 bg-white">
            <div className="flex justify-between items-start mb-1">
              <span className="text-sm font-medium">{new Date(s.scheduledAt).toLocaleString()}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[s.status] ?? "bg-gray-100"}`}>{s.status}</span>
            </div>
            <div className="text-xs text-gray-500 mb-2">{s.durationMinutes} minutes</div>
            {s.summary && <p className="text-sm text-gray-600 mb-2">{s.summary}</p>}

            {s.status === "SCHEDULED" && (
              <div className="flex gap-2 mb-2">
                <button onClick={() => updateSessionStatus(s.id, "COMPLETED")} className="text-xs px-2 py-1 rounded-md border">
                  Mark completed
                </button>
                <button onClick={() => updateSessionStatus(s.id, "CANCELLED")} className="text-xs px-2 py-1 rounded-md border">
                  Cancel
                </button>
                <button onClick={() => updateSessionStatus(s.id, "NO_SHOW")} className="text-xs px-2 py-1 rounded-md border">
                  No-show
                </button>
              </div>
            )}

            <button
              onClick={() => setExpandedSession(expandedSession === s.id ? null : s.id)}
              className="text-xs text-gray-400 underline"
            >
              {expandedSession === s.id ? "Hide my notes" : "My private notes (mentor only)"}
            </button>
            {expandedSession === s.id && <SessionNotes sessionId={s.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionNotes({ sessionId }: { sessionId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/mentor-sessions/${sessionId}/notes`, { credentials: "include" });
    if (res.ok) setNotes((await res.json()).notes ?? []);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/mentor-sessions/${sessionId}/notes`, {
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

  return (
    <div className="mt-2 border-t pt-2">
      {loading ? (
        <div className="text-xs text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-1 mb-2">
          {notes.length === 0 && <div className="text-xs text-gray-400">No notes yet. If you're the mentee, none will ever appear here — these are private to the mentor.</div>}
          {notes.map((n) => (
            <div key={n.id} className="text-xs bg-gray-50 rounded p-2">
              {n.note}
              <div className="text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a private note..."
          className="flex-1 border rounded-md px-2 py-1 text-xs"
        />
        <button onClick={submit} disabled={submitting} className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white disabled:opacity-50">
          Add
        </button>
      </div>
    </div>
  );
}
