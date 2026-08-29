"use client";

import { useState } from "react";
import { phoneNumberSchema, otpSchema, firstErrorMessage } from "@/lib/validation/registration";

export function PhoneVerificationStep({ onComplete }: { onComplete: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"enter_phone" | "enter_code">("enter_phone");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [devModeCode, setDevModeCode] = useState<string | null>(null);
  const [testingBypass, setTestingBypass] = useState(false);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = phoneNumberSchema.safeParse({ phoneE164: phone });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/onboarding/phone/request-otp", {
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

    if (body.devModeCode) {
      // Present outside a real SMS send — see src/lib/domain/sms-provider.ts
      setDevModeCode(body.devModeCode);
      setTestingBypass(Boolean(body.testingBypass));
    }
    setStage("enter_code");
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = otpSchema.safeParse({ code });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/onboarding/phone/verify-otp", {
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
      <h2>Step: Verify your phone</h2>
      {stage === "enter_phone" && (
        <form onSubmit={handleRequestCode}>
          <label>
            Phone number
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              required
            />
          </label>
          {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Sending..." : "Send verification code"}
          </button>
        </form>
      )}
      {stage === "enter_code" && (
        <form onSubmit={handleVerifyCode}>
          <p>Enter the 6-digit code sent to {phone}.</p>
          {devModeCode && testingBypass && (
            <p style={{ background: "#f8d7da", color: "#58151c", padding: "0.75rem", border: "2px solid #dc3545" }}>
              ⚠️ TESTING BYPASS ACTIVE — no real SMS was sent, and this does
              NOT prove you control this phone number. This must be disabled
              (remove ALLOW_INSECURE_OTP_TESTING_BYPASS) before real members
              use this platform. Your code is: <strong>{devModeCode}</strong>
            </p>
          )}
          {devModeCode && !testingBypass && (
            <p style={{ background: "#fff3cd", padding: "0.5rem" }}>
              Development mode — no real SMS was sent. Your code is:{" "}
              <strong>{devModeCode}</strong>
            </p>
          )}
          <label>
            Verification code
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              required
            />
          </label>
          {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Verifying..." : "Verify"}
          </button>
          <button type="button" onClick={() => setStage("enter_phone")}>
            Use a different number
          </button>
        </form>
      )}
    </section>
  );
}
