import assert from "node:assert/strict";
import { determineStep, type AccountStatusResponse } from "../src/lib/onboarding/steps";

type TestFn = () => void;
const tests: [string, TestFn][] = [];
function test(name: string, fn: TestFn) {
  tests.push([name, fn]);
}

function baseResponse(overrides: Partial<AccountStatusResponse> = {}): AccountStatusResponse {
  return {
    ok: true,
    status: "ACTIVE",
    role: "MEMBER",
    emailVerified: true,
    phoneVerified: true,
    hasProfile: true,
    hasFaithProfile: true,
    hasMarriageIntention: true,
    isDiscoverable: true,
    ...overrides,
  };
}

test("no data at all means signed out", () => {
  assert.equal(determineStep(null), "signed_out");
});

test("PENDING_VERIFICATION always routes to email_verification regardless of other flags", () => {
  const data = baseResponse({ status: "PENDING_VERIFICATION", phoneVerified: true, hasProfile: true });
  assert.equal(determineStep(data), "email_verification");
});

test("SUSPENDED/BANNED/DELETED route to blocked even with everything else complete", () => {
  for (const status of ["SUSPENDED", "BANNED", "DELETED", "PENDING_DELETION"]) {
    const data = baseResponse({ status });
    assert.equal(determineStep(data), "blocked", `status ${status} should be blocked`);
  }
});

test("ACTIVE but phone unverified routes to phone_verification", () => {
  const data = baseResponse({ phoneVerified: false });
  assert.equal(determineStep(data), "phone_verification");
});

test("phone verified but no profile routes to personal_info", () => {
  const data = baseResponse({ hasProfile: false });
  assert.equal(determineStep(data), "personal_info");
});

test("profile exists but no faith profile routes to values", () => {
  const data = baseResponse({ hasFaithProfile: false });
  assert.equal(determineStep(data), "values");
});

test("faith profile exists but no marriage intention routes to marriage_intentions", () => {
  const data = baseResponse({ hasMarriageIntention: false });
  assert.equal(determineStep(data), "marriage_intentions");
});

test("everything complete routes to complete", () => {
  const data = baseResponse();
  assert.equal(determineStep(data), "complete");
});

test("step order is checked in the right precedence (phone before profile before values before intentions)", () => {
  // Simulate a user who is behind on every single step -- should always
  // land on the EARLIEST incomplete step, not skip ahead.
  const allIncomplete = baseResponse({
    phoneVerified: false,
    hasProfile: false,
    hasFaithProfile: false,
    hasMarriageIntention: false,
  });
  assert.equal(determineStep(allIncomplete), "phone_verification");
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
console.log(`\nonboarding-steps.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
