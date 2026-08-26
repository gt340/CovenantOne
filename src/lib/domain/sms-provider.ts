import "server-only";

export interface SmsSendResult {
  sent: boolean;
  devModeCode?: string; // only ever populated outside production, see below
}

/// No real SMS provider (Twilio, MessageBird, etc.) is wired up yet — that
/// requires an account, a phone number, and API keys this environment
/// doesn't have. Rather than silently pretending an SMS went out, this
/// function is explicit about what it actually does:
///
///   - In development: logs the code server-side and returns it in the
///     result so a developer can complete the flow locally without a real
///     phone. This never happens outside NODE_ENV=development.
///   - In any other environment: throws, so a misconfigured deployment
///     fails loudly at the point of use instead of silently "succeeding"
///     while sending nothing. Wire up a real provider here before phone
///     verification can work in staging/production.
export async function sendOtpSms(phoneE164: string, code: string): Promise<SmsSendResult> {
  if (process.env.NODE_ENV === "development") {
    console.log(`[dev-only] OTP for ${phoneE164}: ${code}`);
    return { sent: true, devModeCode: code };
  }

  throw new Error(
    "No SMS provider is configured. Wire a real provider (e.g. Twilio) into sendOtpSms() before phone verification can work outside development."
  );
}
