"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type EventType = "WEDDING" | "ENGAGEMENT" | "BIRTHDAY" | "COMMUNITY";

type Event = {
  id: string;
  hostId: string;
  title: string;
  description: string | null;
  location: string | null;
  isVirtual: boolean;
  startAt: string;
  endAt: string;
  capacity: number | null;
  eventType: EventType;
  rsvpCount: number;
  iAmGoing: boolean;
  isHost: boolean;
};

type ConnectionSummary = { id: string; currentStage: string; otherMember: { id: string; displayName: string } };

const TABS: { value: EventType; label: string }[] = [
  { value: "COMMUNITY", label: "Community" },
  { value: "WEDDING", label: "Weddings" },
  { value: "ENGAGEMENT", label: "Engagements" },
  { value: "BIRTHDAY", label: "Birthdays" },
];

export default function EventsPage() {
  const [tab, setTab] = useState<EventType>("COMMUNITY");
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (type: EventType) => {
    setLoading(true);
    const res = await fetch(`/api/events?type=${type}`, { credentials: "include" });
    if (res.ok) setEvents((await res.json()).events ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  async function rsvp(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${id}/rsvp`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      await load(tab);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not RSVP.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Events</h1>
      <p className="text-sm text-gray-500 mb-4">
        Community gatherings, plus weddings, engagements, and birthdays celebrated privately with the people invited.
      </p>

      <div className="flex gap-1 mb-4 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`text-sm px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${
              tab === t.value ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-gray-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <button onClick={() => setShowCreate((s) => !s)} className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white mb-6">
        {showCreate ? "Cancel" : `+ Create ${TABS.find((t) => t.value === tab)?.label.replace(/s$/, "")} Event`}
      </button>

      {showCreate && (
        <CreateEventForm
          defaultType={tab}
          onCreated={() => {
            setShowCreate(false);
            load(tab);
          }}
        />
      )}

      {error && <div className="text-red-600 text-xs mb-4">{error}</div>}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}

      <div className="space-y-2">
        {!loading && events.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">No events here yet.</div>}
        {events.map((e) => (
          <div key={e.id} className="border rounded-md p-3">
            <Link href={`/events/${e.id}`} className="text-sm font-medium hover:underline">
              {e.title}
            </Link>
            <div className="text-xs text-gray-500 mb-1">
              {new Date(e.startAt).toLocaleString()} · {e.isVirtual ? "Virtual" : e.location ?? "TBD"}
            </div>
            {e.description && <p className="text-xs text-gray-600 mb-2">{e.description}</p>}
            <div className="text-xs text-gray-400 mb-2">
              {e.rsvpCount} going{e.capacity ? ` · capacity ${e.capacity}` : ""}
              {e.isHost ? " · you're hosting" : ""}
            </div>
            <button
              onClick={() => rsvp(e.id)}
              disabled={e.iAmGoing || busyId === e.id}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50"
            >
              {e.iAmGoing ? "You're going ✓" : busyId === e.id ? "..." : "RSVP"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateEventForm({ defaultType, onCreated }: { defaultType: EventType; onCreated: () => void }) {
  const [eventType, setEventType] = useState<EventType>(defaultType);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [isVirtual, setIsVirtual] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [celebrant, setCelebrant] = useState("self");
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEventType(defaultType);
  }, [defaultType]);

  useEffect(() => {
    if (eventType !== "COMMUNITY") {
      (async () => {
        const res = await fetch("/api/connections", { credentials: "include" });
        if (res.ok) setConnections((await res.json()).connections ?? []);
      })();
    }
  }, [eventType]);

  async function submit() {
    if (!title.trim() || !startAt || !endAt) {
      setError("Title, start time, and end time are required.");
      return;
    }
    if ((eventType === "WEDDING" || eventType === "ENGAGEMENT") && !connectionId) {
      setError("Choose the connection this celebration is for.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          isVirtual,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          eventType,
          connectionId: connectionId || undefined,
          celebrantUserId: eventType === "BIRTHDAY" && celebrant !== "self" ? celebrant : undefined,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-md p-3 mb-6 space-y-2">
      <label className="block text-xs text-gray-500">Type</label>
      <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} className="w-full border rounded-md px-3 py-2 text-sm">
        {TABS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label.replace(/s$/, "")}
          </option>
        ))}
      </select>

      {(eventType === "WEDDING" || eventType === "ENGAGEMENT") && (
        <>
          <label className="block text-xs text-gray-500">
            Connection {eventType === "WEDDING" ? "(must be at Married)" : "(must be at Marriage Preparation or later)"}
          </label>
          <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
            <option value="">Select a connection</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.otherMember.displayName} — {c.currentStage}
              </option>
            ))}
          </select>
        </>
      )}

      {eventType === "BIRTHDAY" && (
        <>
          <label className="block text-xs text-gray-500">Celebrating</label>
          <select value={celebrant} onChange={(e) => setCelebrant(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
            <option value="self">Myself</option>
            {connections.map((c) => (
              <option key={c.otherMember.id} value={c.otherMember.id}>
                {c.otherMember.displayName}
              </option>
            ))}
          </select>
        </>
      )}

      <input type="text" placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full border rounded-md px-3 py-2 text-sm" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isVirtual} onChange={(e) => setIsVirtual(e.target.checked)} />
        Virtual event
      </label>
      {!isVirtual && (
        <input type="text" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      )}
      <label className="block text-xs text-gray-500">Starts</label>
      <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      <label className="block text-xs text-gray-500">Ends</label>
      <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
        {saving ? "Creating..." : "Create Event"}
      </button>
    </div>
  );
}
