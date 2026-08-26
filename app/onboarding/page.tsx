"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { determineStep, type AccountStatusResponse, type OnboardingStep } from "@/lib/onboarding/steps";
import { EmailVerificationStep } from "@/components/onboarding/EmailVerificationStep";
import { PhoneVerificationStep } from "@/components/onboarding/PhoneVerificationStep";
import { PersonalInfoStep } from "@/components/onboarding/PersonalInfoStep";
import { ValuesStep } from "@/components/onboarding/ValuesStep";
import { MarriageIntentionsStep } from "@/components/onboarding/MarriageIntentionsStep";
import { SignOutButton } from "@/components/SignOutButton";

const STEP_LABELS = [
  "Account",
  "Verification",
  "Personal information",
  "Values",
  "Marriage intentions",
  "Profile completion",
  "Community",
];

const BLOCKED_MESSAGES: Record<string, string> = {
  SUSPENDED:
    "Your account is currently suspended. Contact support if you believe this is a mistake.",
  BANNED: "Your account has been banned.",
  DELETED: "This account has been deleted.",
  PENDING_DELETION: "This account is pending deletion.",
  DEACTIVATED_BY_USER: "This account has been deactivated.",
};

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("loading");
  const [statusData, setStatusData] = useState<AccountStatusResponse | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }
    setEmail(user.email ?? null);

    const res = await fetch("/api/account/status");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    const data: AccountStatusResponse = await res.json();
    setStatusData(data);
    setStep(determineStep(data));
  }, [router]);

  useEffect(() => {
    refresh();
    // Poll while waiting on email confirmation, since that happens in
    // another tab/app (the user's email client) — there's no other signal
    // that tells this page the moment it's done.
    const interval = setInterval(() => {
      if (step === "email_verification") refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [refresh, step]);

  if (step === "loading") {
    return (
      <main>
        <p>Loading...</p>
      </main>
    );
  }

  if (step === "blocked" && statusData) {
    return (
      <main>
        <h1>Account unavailable</h1>
        <p>{BLOCKED_MESSAGES[statusData.status] ?? "This account cannot be accessed."}</p>
        <SignOutButton />
      </main>
    );
  }

  const stepIndexMap: Partial<Record<OnboardingStep, number>> = {
    email_verification: 1,
    phone_verification: 1,
    personal_info: 2,
    values: 3,
    marriage_intentions: 4,
    complete: 6,
  };
  const stepIndex = stepIndexMap[step] ?? 0;

  return (
    <main>
      <nav aria-label="Onboarding progress">
        <ol style={{ display: "flex", gap: "0.5rem", listStyle: "none", padding: 0, flexWrap: "wrap" }}>
          {STEP_LABELS.map((label, i) => (
            <li
              key={label}
              style={{
                fontWeight: i === stepIndex ? "bold" : "normal",
                color: i <= stepIndex ? "#000" : "#999",
              }}
            >
              {label}
              {i < STEP_LABELS.length - 1 ? " →" : ""}
            </li>
          ))}
        </ol>
      </nav>

      {step === "email_verification" && <EmailVerificationStep email={email} />}
      {step === "phone_verification" && <PhoneVerificationStep onComplete={refresh} />}
      {step === "personal_info" && <PersonalInfoStep onComplete={refresh} />}
      {step === "values" && <ValuesStep onComplete={refresh} />}
      {step === "marriage_intentions" && <MarriageIntentionsStep onComplete={refresh} />}
      {step === "complete" && (
        <section>
          <h2>Welcome to the community</h2>
          <p>
            Your profile is complete. Discovery and introductions come in a
            later phase — for now, your account is fully set up and active.
          </p>
          <SignOutButton />
        </section>
      )}
    </main>
  );
}


