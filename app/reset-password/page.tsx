"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resetPasswordSchema, firstErrorMessage } from "@/lib/validation/registration";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    const parsed = resetPasswordSchema.safeParse({ password });
    if (!parsed.success) {
      setError(firstErrorMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    // By the time this page loads, /auth/callback has already exchanged the
    // recovery link's code for a session — updateUser operates on that
    // session, no separate token needs to be threaded through manually.
    const { error: updateError } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
    setTimeout(() => {
      router.push("/onboarding");
      router.refresh();
    }, 1500);
  }

  if (done) {
    return (
      <main>
        <h1>Password updated</h1>
        <p>Redirecting...</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Set a new password</h1>
      <form onSubmit={handleSubmit}>
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={10}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={10}
          />
        </label>
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Updating..." : "Update password"}
        </button>
      </form>
    </main>
  );
}
