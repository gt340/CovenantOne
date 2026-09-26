"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

type Milestone = { name: string; completedAt: string | null };

type Journey = {
  id: string;
  connectionId: string;
  preparationStartedAt: string | null;
  milestones: Milestone[] | null;
  marriedAt: string | null;
};

const DEFAULT_MILESTONES: Milestone[] = [
  { name: "Premarital counseling session 1", completedAt: null },
  { name: "Premarital counseling session 2", completedAt: null },
  { name: "Financial planning session", completedAt: null },
  { name: "Family meeting", completedAt: null },
  { name: "Wedding date set", completedAt: null },
];

export default function MarriageJourneyPage() {
  const params = useParams<{ connectionId: string }>();
  const connectionId = params.connectionId;
  const [journey, setJourney] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newMilestone, setNewMilestone] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/marriage-journey/${connectionId}`, { credentials: "include" });
    if (res.ok) setJourney((await res.json()).journey);
    setLoading(false);
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(milestones: Milestone[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/marriage-journey/${connectionId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestones }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  function toggle(index: number) {
    const list = journey?.milestones?.length ? [...journey.milestones] : [...DEFAULT_MILESTONES];
    list[index] = { ...list[index], completedAt: list[index].completedAt ? null : new Date().toISOString() };
    save(list);
  }

  function addMilestone() {
    if (!newMilestone.trim()) return;
    const list = journey?.milestones?.length ? [...journey.milestones] : [...DEFAULT_MILESTONES];
    list.push({ name: newMilestone.trim(), completedAt: null });
    setNewMilestone("");
    save(list);
  }

  if (loading) return <div className="text-center text-gray-400 py-12">Loading...</div>;

  if (!journey) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold mb-2">Marriage Journey</h1>
        <p className="text-sm text-gray-500">
          This starts automatically once the relationship reaches Marriage Preparation. Nothing here yet.
        </p>
      </div>
    );
  }

  const milestones = journey.milestones?.length ? journey.milestones : DEFAULT_MILESTONES;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Marriage Journey</h1>
      {journey.marriedAt ? (
        <p className="text-sm text-green-600 mb-6">Married {new Date(journey.marriedAt).toLocaleDateString()} 🎉</p>
      ) : (
        <p className="text-sm text-gray-500 mb-6">
          In preparation since{" "}
          {journey.preparationStartedAt ? new Date(journey.preparationStartedAt).toLocaleDateString() : "—"}
        </p>
      )}

      {error && <div className="text-red-600 text-xs mb-4">{error}</div>}

      <div className="space-y-2 mb-4">
        {milestones.map((m, i) => (
          <label key={i} className="flex items-center gap-2 border rounded-md p-3 text-sm">
            <input type="checkbox" checked={!!m.completedAt} disabled={saving} onChange={() => toggle(i)} />
            <span className={m.completedAt ? "line-through text-gray-400" : ""}>{m.name}</span>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add a milestone"
          value={newMilestone}
          onChange={(e) => setNewMilestone(e.target.value)}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={addMilestone} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
          Add
        </button>
      </div>
    </div>
  );
}
