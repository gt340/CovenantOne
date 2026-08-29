import "server-only";

export interface SmsSendResult {
  sent: boolean;
  devModeCode?: string; // populated outside production ONLY via dev mode or the explicit testing bypass below
  testingBypass?: boolean; // true only when the production bypass path was used — lets the UI say so honestly
}

/// No real SMS provider (Twilio, MessageBird, etc.) is wired up yet — that
/// requires an account, a phone number, and API keys this environment
/// doesn't have. Rather than silently pretending an SMS went out, this
/// function is explicit about what it actually does, in three cases:
///
///   1. Development (NODE_ENV=development): logs the code server-side and
///      returns it in the result so a developer can complete the flow
///      locally without a real phone.
///
///   2. Production/staging WITH the testing bypass flag explicitly set:
///      same behavior as (1) — code is not actually texted, it's returned
///      in the API response — but ONLY because someone deliberately set
///      ALLOW_INSECURE_OTP_TESTING_BYPASS=true in that environment's env
///      vars. This exists so Phase 2 could be walked through end-to-end on
///      a real Vercel deploy before a real SMS provider is wired up. The
///      name is deliberately alarming and the behavior is logged loudly
///      every time it fires, so it can't be mistaken for normal production
///      behavior or left on unnoticed. REMOVE THIS ENV VAR once a real
///      provider is integrated, or before any real user could reach this
///      code path — it means phone verification provides no actual proof
///      the member controls that phone number.
///
///   3. Everything else: throws, so a misconfigured deployment fails loudly
///      at the point of use instead of silently "succeeding" while sending
///      nothing.
export async function sendOtpSms(phoneE164: string, code: string): Promise<SmsSendResult> {
  if (process.env.NODE_ENV === "development") {
    console.log(`[dev-only] OTP for ${phoneE164}: ${code}`);
    return { sent: true, devModeCode: code };
  }

  if (process.env.ALLOW_INSECURE_OTP_TESTING_BYPASS === "true") {
    console.warn(
      `[SECURITY BYPASS ACTIVE] ALLOW_INSECURE_OTP_TESTING_BYPASS is enabled — OTP for ${phoneE164} was NOT sent via SMS and is being returned directly in the API response instead. This provides no real proof of phone ownership. Remove this env var once testing is done.`
    );
    return { sent: true, devModeCode: code, testingBypass: true };
  }

  throw new Error(
    "No SMS provider is configured. Wire a real provider (e.g. Twilio) into sendOtpSms() before phone verification can work outside development."
  );
}
