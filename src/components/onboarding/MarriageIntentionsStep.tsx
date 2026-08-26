"use client";

import { useState } from "react";
import { marriageIntentionSchema, firstErrorMessage } from "@/lib/validation/registration";

export function MarriageIntentionsStep({ onComplete }: { onComplete: () => void }) {
  const [timeframe, setTimeframe] = useState("");
  const [wantsChildren, setWantsChildren] = useState("");
  const [hasChildrenAlready, setHasChildrenAlready] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = marriageIntentionSchema.safeParse({
      timeframe,
      wantsChildren: wantsChildren === "" ? undefined : wantsChildren === "yes",
      hasChildrenAlready,
    });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/onboarding/marriage-intentions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok || !body.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }

    onComplete();
  }

  return (
    <section>
      <h2>Step: Marriage intentions</h2>
      <form onSubmit={handleSubmit}>
        <label>
          When are you hoping to marry?
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} required>
            <option value="">Select...</option>
            <option value="WITHIN_A_YEAR">Within a year</option>
            <option value="ONE_TO_TWO_YEARS">1–2 years</option>
            <option value="TWO_PLUS_YEARS">2+ years</option>
            <option value="WHEN_RIGHT_PERSON_FOUND">When I find the right person</option>
          </select>
        </label>
        <label>
          Do you want children?
          <select value={wantsChildren} onChange={(e) => setWantsChildren(e.target.value)}>
            <option value="">Prefer not to say yet</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={hasChildrenAlready}
            onChange={(e) => setHasChildrenAlready(e.target.checked)}
          />
          I already have children
        </label>
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Finish"}
        </button>
      </form>
    </section>
  );
}
