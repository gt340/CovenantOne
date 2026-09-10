"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const FAITH_LEVELS = ["EXPLORING", "IMPORTANT", "VERY_IMPORTANT", "CENTRAL"];
const EDUCATION_LEVELS = [
  "HIGH_SCHOOL",
  "SOME_COLLEGE",
  "TRADE_VOCATIONAL",
  "ASSOCIATE",
  "BACHELORS",
  "MASTERS",
  "DOCTORATE",
  "OTHER",
];
const TIMEFRAMES = [
  { value: "WITHIN_A_YEAR", label: "Within a year" },
  { value: "ONE_TO_TWO_YEARS", label: "One to two years" },
  { value: "TWO_PLUS_YEARS", label: "Two or more years" },
  { value: "WHEN_RIGHT_PERSON_FOUND", label: "When I find the right person" },
];

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

export default function PreferencesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [preferredGender, setPreferredGender] = useState("FEMALE");
  const [minAge, setMinAge] = useState(25);
  const [maxAge, setMaxAge] = useState(40);
  const [maxDistanceKm, setMaxDistanceKm] = useState<string>("");
  const [requireSameFaith, setRequireSameFaith] = useState(false);
  const [minFaithImportance, setMinFaithImportance] = useState<string>("");
  const [minEducationLevel, setMinEducationLevel] = useState<string>("");
  const [openToChildrenAlready, setOpenToChildrenAlready] = useState(true);
  const [openToRelocation, setOpenToRelocation] = useState(false);
  const [prefNotes, setPrefNotes] = useState("");

  const [seriouslySeekingMarriage, setSeriouslySeekingMarriage] = useState(true);
  const [timeframe, setTimeframe] = useState("WHEN_RIGHT_PERSON_FOUND");
  const [wantsChildren, setWantsChildren] = useState<string>("unspecified"); // "yes" | "no" | "unspecified"
  const [numberOfChildrenDesired, setNumberOfChildrenDesired] = useState<string>("");
  const [hasChildrenAlready, setHasChildrenAlready] = useState(false);
  const [miNotes, setMiNotes] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/preferences", { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.partnerPreferences) {
          const p = data.partnerPreferences;
          setPreferredGender(p.preferredGender);
          setMinAge(p.minAge);
          setMaxAge(p.maxAge);
          setMaxDistanceKm(p.maxDistanceKm?.toString() ?? "");
          setRequireSameFaith(p.requireSameFaith);
          setMinFaithImportance(p.minFaithImportance ?? "");
          setMinEducationLevel(p.minEducationLevel ?? "");
          setOpenToChildrenAlready(p.openToChildrenAlready);
          setOpenToRelocation(p.openToRelocation);
          setPrefNotes(p.notes ?? "");
        }
        if (data.marriageIntentions) {
          const m = data.marriageIntentions;
          setSeriouslySeekingMarriage(m.seriouslySeekingMarriage);
          setTimeframe(m.timeframe);
          setWantsChildren(m.wantsChildren === null ? "unspecified" : m.wantsChildren ? "yes" : "no");
          setNumberOfChildrenDesired(m.numberOfChildrenDesired?.toString() ?? "");
          setHasChildrenAlready(m.hasChildrenAlready);
          setMiNotes(m.notes ?? "");
        }
      } catch {
        // no existing preferences yet — defaults stand
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerPreferences: {
            preferredGender,
            minAge: Number(minAge),
            maxAge: Number(maxAge),
            maxDistanceKm: maxDistanceKm ? Number(maxDistanceKm) : null,
            requireSameFaith,
            minFaithImportance: minFaithImportance || null,
            minEducationLevel: minEducationLevel || null,
            openToChildrenAlready,
            openToRelocation,
            notes: prefNotes,
          },
          marriageIntentions: {
            seriouslySeekingMarriage,
            timeframe,
            wantsChildren: wantsChildren === "unspecified" ? null : wantsChildren === "yes",
            numberOfChildrenDesired: numberOfChildrenDesired ? Number(numberOfChildrenDesired) : null,
            hasChildrenAlready,
            notes: miNotes,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save preferences.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="max-w-xl mx-auto px-4 py-12 text-center text-gray-400">Loading...</div>;
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8 pb-24">
      <Link href="/discover" className="text-sm text-blue-600 mb-4 inline-block">
        ← Back to Find a Life Partner
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Compatibility Preferences</h1>
      <p className="text-sm text-gray-500 mb-6">
        These answers shape who you're matched with and how compatibility is calculated. You can
        update them any time.
      </p>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Who you're looking for</h2>
        <div className="space-y-4">
          <Field label="Interested in">
            <select
              value={preferredGender}
              onChange={(e) => setPreferredGender(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="MALE">Men</option>
              <option value="FEMALE">Women</option>
            </select>
          </Field>

          <div className="flex gap-3">
            <Field label="Min age" className="flex-1">
              <input
                type="number"
                min={18}
                value={minAge}
                onChange={(e) => setMinAge(Number(e.target.value))}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Max age" className="flex-1">
              <input
                type="number"
                min={18}
                value={maxAge}
                onChange={(e) => setMaxAge(Number(e.target.value))}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <Field label="Maximum distance (km, optional)">
            <input
              type="number"
              value={maxDistanceKm}
              onChange={(e) => setMaxDistanceKm(e.target.value)}
              placeholder="No limit"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </Field>

          <Checkbox
            checked={openToRelocation}
            onChange={setOpenToRelocation}
            label="I'm open to relocating for the right person"
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Faith &amp; education</h2>
        <div className="space-y-4">
          <Checkbox
            checked={requireSameFaith}
            onChange={setRequireSameFaith}
            label="I require a partner who shares my faith"
          />
          <Field label="Minimum faith importance in a partner (optional)">
            <select
              value={minFaithImportance}
              onChange={(e) => setMinFaithImportance(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">No preference</option>
              {FAITH_LEVELS.map((v) => (
                <option key={v} value={v}>
                  {formatLabel(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Minimum education level (optional)">
            <select
              value={minEducationLevel}
              onChange={(e) => setMinEducationLevel(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">No preference</option>
              {EDUCATION_LEVELS.map((v) => (
                <option key={v} value={v}>
                  {formatLabel(v)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Children</h2>
        <Checkbox
          checked={openToChildrenAlready}
          onChange={setOpenToChildrenAlready}
          label="I'm open to a partner who already has children"
        />
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Your own marriage intentions</h2>
        <div className="space-y-4">
          <Checkbox
            checked={seriouslySeekingMarriage}
            onChange={setSeriouslySeekingMarriage}
            label="I am seriously seeking marriage, not just dating casually"
          />
          <Field label="When are you hoping to marry?">
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              {TIMEFRAMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Do you want children?">
            <select
              value={wantsChildren}
              onChange={(e) => setWantsChildren(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="unspecified">Prefer not to say / not sure yet</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          {wantsChildren === "yes" && (
            <Field label="How many, if you have a preference (optional)">
              <input
                type="number"
                min={1}
                value={numberOfChildrenDesired}
                onChange={(e) => setNumberOfChildrenDesired(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </Field>
          )}
          <Checkbox
            checked={hasChildrenAlready}
            onChange={setHasChildrenAlready}
            label="I already have children"
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Anything else</h2>
        <Field label="Notes on what you're looking for (optional)">
          <textarea
            value={prefNotes}
            onChange={(e) => setPrefNotes(e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Notes on your own intentions (optional)" className="mt-3">
          <textarea
            value={miNotes}
            onChange={(e) => setMiNotes(e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </Field>
      </section>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}
      {saved && (
        <div className="border border-green-200 bg-green-50 text-green-700 text-sm rounded-md px-4 py-3 mb-4">
          Preferences saved.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Preferences"}
      </button>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  );
}
