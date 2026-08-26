import assert from "node:assert/strict";
import {
  generateOtpCode,
  hashOtpCode,
  otpExpiryDate,
  verifyOtp,
  OTP_MAX_ATTEMPTS,
} from "../src/lib/domain/otp";

type TestFn = () => void;
const tests: [string, TestFn][] = [];
function test(name: string, fn: TestFn) {
  tests.push([name, fn]);
}

test("generateOtpCode always produces a 6-digit zero-padded string", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateOtpCode();
    assert.equal(code.length, 6, `code "${code}" should be length 6`);
    assert.match(code, /^\d{6}$/, `code "${code}" should be all digits`);
  }
});

test("hashOtpCode is deterministic and never returns the raw code", () => {
  const code = "123456";
  const hash1 = hashOtpCode(code);
  const hash2 = hashOtpCode(code);
  assert.equal(hash1, hash2);
  assert.notEqual(hash1, code);
  assert.equal(hash1.length, 64); // sha256 hex digest
});

test("verifyOtp accepts a correct, unexpired, first-attempt code", () => {
  const code = "654321";
  const now = new Date("2026-01-01T00:00:00Z");
  const record = {
    otpCodeHash: hashOtpCode(code),
    otpExpiresAt: otpExpiryDate(now),
    otpAttempts: 0,
  };
  const result = verifyOtp(code, record, now);
  assert.equal(result.ok, true);
});

test("verifyOtp rejects when no code was ever requested", () => {
  const result = verifyOtp("123456", { otpCodeHash: null, otpExpiresAt: null, otpAttempts: 0 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "NO_CODE_REQUESTED");
});

test("verifyOtp rejects an incorrect code", () => {
  const record = {
    otpCodeHash: hashOtpCode("111111"),
    otpExpiresAt: otpExpiryDate(),
    otpAttempts: 0,
  };
  const result = verifyOtp("222222", record);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "INCORRECT");
});

test("verifyOtp rejects an expired code even if correct", () => {
  const code = "999999";
  const requestedAt = new Date("2026-01-01T00:00:00Z");
  const record = {
    otpCodeHash: hashOtpCode(code),
    otpExpiresAt: otpExpiryDate(requestedAt),
    otpAttempts: 0,
  };
  const wayLater = new Date("2026-01-02T00:00:00Z"); // 1 day later, TTL is 10 min
  const result = verifyOtp(code, record, wayLater);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "EXPIRED");
});

test("verifyOtp rejects once attempts are exhausted, even with the correct code", () => {
  const code = "555555";
  const record = {
    otpCodeHash: hashOtpCode(code),
    otpExpiresAt: otpExpiryDate(),
    otpAttempts: OTP_MAX_ATTEMPTS,
  };
  const result = verifyOtp(code, record);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "TOO_MANY_ATTEMPTS");
});

// --- Test runner -----------------------------------------------------------
let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`         ${(err as Error).message}`);
  }
}
console.log(`\notp.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
