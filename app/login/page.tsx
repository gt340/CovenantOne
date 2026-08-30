"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signInSchema, firstErrorMessage } from "@/lib/validation/registration";

type Mode = "password" | "magic_link";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [passkeyUnsupported, setPasskeyUnsupported] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword(parsed.data);
    setSubmitting(false);

    if (signInError) {
      // Generic on purpose — doesn't reveal whether the email exists or the
      // password was wrong (standard practice against credential-stuffing
      // account enumeration).
      setError("Incorrect email or password.");
      return;
    }

    goToOnboarding();
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = signInSchema.pick({ email: true }).safeParse({ email });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setSubmitting(false);

    if (otpError) {
      setError("Something went wrong. Please try again.");
      return;
    }

    // Generic confirmation on purpose — same account-enumeration reasoning
    // as password sign-in and sign-up.
    setMagicLinkSent(true);
  }

  async function handleGoogleSignIn() {
    setError(null);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    // On success, Supabase redirects the browser to Google immediately —
    // this line only runs if something failed before that redirect (e.g.
    // Google isn't actually configured yet in the Supabase dashboard).
    if (oauthError) {
      setError(
        "Google sign-in isn't available right now. This usually means Google OAuth hasn't been configured in the Supabase dashboard yet."
      );
    }
  }

  async function handlePasskeySignIn() {
    setError(null);
    setPasskeyUnsupported(false);

    if (typeof window !== "undefined" && !window.PublicKeyCredential) {
      setPasskeyUnsupported(true);
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    // No email needed upfront — the authenticator/passkey manager picks the
    // matching account.
    const { error: passkeyError } = await supabase.auth.signInWithPasskey();
    setSubmitting(false);

    if (passkeyError) {
      setError(
        "Passkey sign-in didn't work. Make sure you've registered a passkey for this account from Account settings, and that this browser/device supports it."
      );
      return;
    }

    goToOnboarding();
  }

  function goToOnboarding() {
    // Server-side account status (SUSPENDED/BANNED/DELETED) is enforced by
    // every API route via requireActiveUser() regardless of what happens
    // here — this redirect is just where to send a successful sign-in, not
    // an access-control decision in itself.
    router.push("/onboarding");
    router.refresh();
  }

  if (magicLinkSent) {
    return (
      <main>
        <h1>Check your email</h1>
        <p>If an account exists for {email}, we&apos;ve sent a sign-in link.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Sign in</h1>

      <button type="button" onClick={handleGoogleSignIn}>
        Continue with Google
      </button>

      <div>
        <button type="button" onClick={handlePasskeySignIn} disabled={submitting}>
          Sign in with a passkey
        </button>
        {passkeyUnsupported && (
          <p role="alert" style={{ color: "#b00020" }}>
            This browser or device doesn&apos;t support passkeys.
          </p>
        )}
      </div>

      <hr />

      <div role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          onClick={() => {
            setMode("password");
            setError(null);
          }}
        >
          Password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "magic_link"}
          onClick={() => {
            setMode("magic_link");
            setError(null);
          }}
        >
          Magic Link
        </button>
      </div>

      {mode === "password" && (
        <form onSubmit={handlePasswordSubmit}>
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
              autoComplete="current-password"
            />
          </label>
          {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      )}

      {mode === "magic_link" && (
        <form onSubmit={handleMagicLinkSubmit}>
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
            {submitting ? "Sending..." : "Send magic link"}
          </button>
        </form>
      )}

      <p>
        <a href="/forgot-password">Forgot your password?</a>
      </p>
      <p>
        Don&apos;t have an account? <a href="/signup">Create one</a>
      </p>
    </main>
  );
}

