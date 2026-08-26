"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function EmailVerificationStep({ email }: { email: string | null }) {
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    if (!email) return;
    setError(null);
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
    });
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setResent(true);
  }

  return (
    <section>
      <h2>Step: Verification</h2>
      <p>
        We&apos;ve sent a confirmation link to your email. Click it to
        continue — this page will move to the next step automatically once
        it&apos;s confirmed.
      </p>
      {email && (
        <button type="button" onClick={handleResend}>
          Resend confirmation email
        </button>
      )}
      {resent && <p>Sent again — check your inbox.</p>}
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
    </section>
  );
}
