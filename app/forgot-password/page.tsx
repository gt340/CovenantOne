"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { forgotPasswordSchema, firstErrorMessage } from "@/lib/validation/registration";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setSubmitting(false);
    // Always show the same confirmation regardless of whether the email
    // exists — same account-enumeration reasoning as sign-up/sign-in.
    setSent(true);
  }

  if (sent) {
    return (
      <main>
        <h1>Check your email</h1>
        <p>
          If an account exists for {email}, we&apos;ve sent a link to reset
          your password.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Reset your password</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Sending..." : "Send reset link"}
        </button>
      </form>
    </main>
  );
}
