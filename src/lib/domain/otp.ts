import { createHash, randomInt } from "node:crypto";

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  // randomInt is cryptographically secure (unlike Math.random) and gives a
  // uniform 0-999999 range, zero-padded to 6 digits.
  const n = randomInt(0, 10 ** OTP_LENGTH);
  return n.toString().padStart(OTP_LENGTH, "0");
}

// SHA-256 is sufficient here (not a password — a 6-digit code with a short
// TTL and a capped attempt count), and avoids the cost of argon2/bcrypt for
// a high-volume, low-entropy, short-lived secret. Never store the raw code.
export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function otpExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + OTP_TTL_MINUTES * 60 * 1000);
}

export interface OtpVerificationRecord {
  otpCodeHash: string | null;
  otpExpiresAt: Date | null;
  otpAttempts: number;
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "NO_CODE_REQUESTED" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "INCORRECT" };

/// Pure decision function — the route handler does the actual DB read/write,
/// this just decides whether a submitted code is acceptable given the
/// stored record and the current time.
export function verifyOtp(
  submittedCode: string,
  record: OtpVerificationRecord,
  now: Date = new Date()
): OtpVerifyResult {
  if (!record.otpCodeHash || !record.otpExpiresAt) {
    return { ok: false, reason: "NO_CODE_REQUESTED" };
  }
  if (record.otpAttempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
  }
  if (now.getTime() > record.otpExpiresAt.getTime()) {
    return { ok: false, reason: "EXPIRED" };
  }
  if (hashOtpCode(submittedCode) !== record.otpCodeHash) {
    return { ok: false, reason: "INCORRECT" };
  }
  return { ok: true };
}
