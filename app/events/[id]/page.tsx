"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

type Attendee = { userId: string; rsvpAt: string; attended: boolean | null; invitedByUserId: string | null };

type EventDetail = {
  id: string;
  hostId: string;
  title: string;
  description: string | null;
  location: string | null;
  isVirtual: boolean;
  startAt: string;
  endAt: string;
  capacity: number | null;
  isCancelled: boolean;
  eventType: "WEDDING" | "ENGAGEMENT" | "BIRTHDAY" | "COMMUNITY";
  isHost: boolean;
};

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [iAmGoing, setIAmGoing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteId, setInviteId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/events/${id}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setEvent(data.event);
      setAttendees(data.attendees ?? []);
      setIAmGoing(data.iAmGoing);
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error ?? "Could not load this event.");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function rsvp(targetUserId?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${id}/rsvp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetUserId ? { targetUserId } : {}),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      setInviteId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not RSVP.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-center text-gray-400 py-12">Loading...</div>;
  if (!event) return <div className="max-w-2xl mx-auto px-4 py-8 text-sm text-red-600">{error ?? "Event not found."}</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="text-xs uppercase tracking-wide text-blue-600 mb-1">{event.eventType}</div>
      <h1 className="text-2xl font-semibold mb-1">{event.title}</h1>
      <div className="text-sm text-gray-500 mb-1">
        {new Date(event.startAt).toLocaleString()} – {new Date(event.endAt).toLocaleString()}
      </div>
      <div className="text-sm text-gray-500 mb-4">{event.isVirtual ? "Virtual" : event.location ?? "Location TBD"}</div>
      {event.description && <p className="text-sm text-gray-700 mb-4">{event.description}</p>}
      {event.isCancelled && <div className="text-sm text-red-600 mb-4">This event has been cancelled.</div>}

      {error && <div className="text-red-600 text-xs mb-4">{error}</div>}

      {!event.isCancelled && (
        <button
          onClick={() => rsvp()}
          disabled={iAmGoing || busy}
          className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50 mb-6"
        >
          {iAmGoing ? "You're going ✓" : busy ? "..." : "RSVP"}
        </button>
      )}

      <h2 className="text-sm font-medium mb-2">
        Guest list ({attendees.length}
        {event.capacity ? ` / ${event.capacity}` : ""})
      </h2>
      <div className="space-y-1 mb-6">
        {attendees.length === 0 && <div className="text-xs text-gray-400">No one yet.</div>}
        {attendees.map((a) => (
          <div key={a.userId} className="text-xs text-gray-600 border rounded-md px-3 py-2">
            {a.userId === event.hostId ? "Host" : "Guest"} · RSVP'd {new Date(a.rsvpAt).toLocaleDateString()}
            {a.invitedByUserId ? " · invited by host" : ""}
          </div>
        ))}
      </div>

      {event.isHost && (
        <div className="border rounded-md p-3">
          <div className="text-sm font-medium mb-2">Invite a guest</div>
          <p className="text-xs text-gray-500 mb-2">Add a fellow member to this guest list by their member ID.</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Member ID"
              value={inviteId}
              onChange={(e) => setInviteId(e.target.value)}
              className="flex-1 border rounded-md px-3 py-2 text-sm"
            />
            <button
              onClick={() => rsvp(inviteId)}
              disabled={!inviteId.trim() || busy}
              className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50"
            >
              Invite
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
