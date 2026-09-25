import crypto from "crypto";

/**
 * Payment provider integration boundary for the Community Support Fund.
 *
 * This module deliberately does NOT simulate or fake a successful payment anywhere. If no real
 * provider credentials are configured, every function here either throws a clear "not connected"
 * error or returns isConfigured: false, and callers must surface that honestly to the user rather
 * than pretending a donation went through.
 *
 * To go live: set PAYSTACK_SECRET_KEY (and PAYSTACK_PUBLIC_KEY for the client) in the environment.
 * A key starting with "sk_test_" is treated as sandbox/test mode; "sk_live_" is treated as
 * production. Every donation record stores which mode it was made under (donations.isTestMode) so
 * test and real money can never be confused in the data.
 */

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = "https://api.paystack.co";

export function isPaymentProviderConfigured(): boolean {
  return !!PAYSTACK_SECRET_KEY;
}

export function isTestMode(): boolean {
  if (!PAYSTACK_SECRET_KEY) return true; // unconfigured is always treated as sandbox, never as "live"
  return PAYSTACK_SECRET_KEY.startsWith("sk_test_");
}

type InitResult = { authorizationUrl: string; reference: string };

/**
 * Starts a real Paystack transaction and returns the checkout URL to redirect the donor to.
 * Throws if the provider isn't configured — callers must catch this and show an honest message,
 * never a fabricated success.
 */
export async function initializeTransaction(params: {
  amountCents: number;
  email: string;
  reference: string;
  callbackUrl: string;
}): Promise<InitResult> {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
  }
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amountCents,
      email: params.email,
      reference: params.reference,
      callback_url: params.callbackUrl,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data?.status) {
    throw new Error(data?.message || "Payment provider request failed");
  }
  return { authorizationUrl: data.data.authorization_url, reference: data.data.reference };
}

/**
 * Verifies a Paystack webhook's HMAC-SHA512 signature against the raw request body, per Paystack's
 * documented webhook security model. Returns false (never throws) if unconfigured, so callers can
 * safely reject any incoming webhook when there's no real provider wired in.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!PAYSTACK_SECRET_KEY || !signatureHeader) return false;
  const hash = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  return hash === signatureHeader;
}
