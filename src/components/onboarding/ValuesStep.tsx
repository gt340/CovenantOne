"use client";

import { useState } from "react";
import { valuesSchema, firstErrorMessage } from "@/lib/validation/registration";

export function ValuesStep({ onComplete }: { onComplete: () => void }) {
  const [faithImportance, setFaithImportance] = useState("");
  const [denomination, setDenomination] = useState("");
  const [faithCommunity, setFaithCommunity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = valuesSchema.safeParse({ faithImportance, denomination, faithCommunity });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/onboarding/values", {
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
      <h2>Step: Values</h2>
      <form onSubmit={handleSubmit}>
        <label>
          How important is faith to you?
          <select
            value={faithImportance}
            onChange={(e) => setFaithImportance(e.target.value)}
            required
          >
            <option value="">Select...</option>
            <option value="CENTRAL">Central to my life</option>
            <option value="VERY_IMPORTANT">Very important</option>
            <option value="IMPORTANT">Important</option>
            <option value="EXPLORING">Still exploring</option>
          </select>
        </label>
        <label>
          Denomination (optional)
          <input value={denomination} onChange={(e) => setDenomination(e.target.value)} />
        </label>
        <label>
          Faith community / church (optional)
          <input value={faithCommunity} onChange={(e) => setFaithCommunity(e.target.value)} />
        </label>
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Continue"}
        </button>
      </form>
    </section>
  );
}
