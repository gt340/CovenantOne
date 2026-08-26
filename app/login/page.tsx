"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signInSchema, firstErrorMessage } from "@/lib/validation/registration";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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

    // Server-side account status (SUSPENDED/BANNED/DELETED) is enforced by
    // every API route via requireActiveUser() regardless of what happens
    // here — this redirect is just where to send a successful sign-in, not
    // an access-control decision in itself.
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <main>
      <h1>Sign in</h1>
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
            autoComplete="current-password"
          />
        </label>
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p>
        <a href="/forgot-password">Forgot your password?</a>
      </p>
      <p>
        Don&apos;t have an account? <a href="/signup">Create one</a>
      </p>
    </main>
  );
}
