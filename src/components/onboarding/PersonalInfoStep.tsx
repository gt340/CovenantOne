"use client";

import { useState } from "react";
import { personalInfoSchema, firstErrorMessage } from "@/lib/validation/registration";

export function PersonalInfoStep({ onComplete }: { onComplete: () => void }) {
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = personalInfoSchema.safeParse({
      fullName,
      dateOfBirth,
      gender,
      country,
      city,
      maritalStatus,
    });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/onboarding/personal-info", {
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
      <h2>Step: Personal information</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Date of birth
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            required
          />
        </label>
        <p style={{ fontSize: "0.85rem", color: "#555" }}>
          You must be at least 18 years old to join.
        </p>
        <label>
          Gender
          <select value={gender} onChange={(e) => setGender(e.target.value)} required>
            <option value="">Select...</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </label>
        <label>
          Country
          <input value={country} onChange={(e) => setCountry(e.target.value)} required />
        </label>
        <label>
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} required />
        </label>
        <label>
          Marital status
          <select
            value={maritalStatus}
            onChange={(e) => setMaritalStatus(e.target.value)}
            required
          >
            <option value="">Select...</option>
            <option value="SINGLE">Single</option>
            <option value="DIVORCED">Divorced</option>
            <option value="WIDOWED">Widowed</option>
            <option value="SEPARATED">Separated</option>
          </select>
        </label>
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Continue"}
        </button>
      </form>
    </section>
  );
}
