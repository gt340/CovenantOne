"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signUpSchema, firstErrorMessage } from "@/lib/validation/registration";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleGoogleSignUp() {
    setError(null);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    if (oauthError) {
      setError(
        "Google sign-up isn't available right now. This usually means Google OAuth hasn't been configured in the Supabase dashboard yet."
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = signUpSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setSubmitting(false);

    if (signUpError) {
      // Deliberately generic for account-enumeration safety: we don't
      // confirm or deny whether this email already has an account. Supabase
      // itself returns a generic-looking success response for "email
      // already registered" under most project configurations for the same
      // reason — this message matches that intent even on the rare error
      // path. See PHASE2_REPORT.md for the tradeoff this represents.
      setError("Something went wrong. Please check your details and try again.");
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <main>
        <h1>Check your email</h1>
        <p>
          If {email} isn&apos;t already registered, we&apos;ve sent a
          confirmation link. Click it to continue creating your account.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Create your account</h1>

      <button type="button" onClick={handleGoogleSignUp}>
        Continue with Google
      </button>

      <hr />

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
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={10}
          />
        </label>
        <p style={{ fontSize: "0.85rem", color: "#555" }}>
          At least 10 characters, with an uppercase letter, a lowercase
          letter, and a number.
        </p>
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Create account"}
        </button>
      </form>
      <p>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </main>
  );
}

