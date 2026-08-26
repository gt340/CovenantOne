import assert from "node:assert/strict";
import {
  canAccessApp,
  canAccessOnboardingVerificationStep,
  canAccessOnboardingPostVerificationSteps,
  type UserStatus,
} from "../src/lib/domain/account-status";

type TestFn = () => void;
const tests: [string, TestFn][] = [];
function test(name: string, fn: TestFn) {
  tests.push([name, fn]);
}

test("only ACTIVE grants full app access", () => {
  const statuses: UserStatus[] = [
    "ACTIVE",
    "PENDING_VERIFICATION",
    "SUSPENDED",
    "BANNED",
    "DEACTIVATED_BY_USER",
    "PENDING_DELETION",
    "DELETED",
  ];
  for (const s of statuses) {
    const decision = canAccessApp(s);
    assert.equal(decision.allowed, s === "ACTIVE", `status ${s} allowed should be ${s === "ACTIVE"}`);
  }
});

test("every non-ACTIVE denial carries a specific reason, not a generic one", () => {
  const denied = canAccessApp("SUSPENDED");
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "SUSPENDED");

  const banned = canAccessApp("BANNED");
  assert.equal(banned.reason, "BANNED");

  const deleted = canAccessApp("DELETED");
  assert.equal(deleted.reason, "DELETED");
});

test("PENDING_VERIFICATION and ACTIVE can reach the verification step; nothing else can", () => {
  assert.equal(canAccessOnboardingVerificationStep("PENDING_VERIFICATION"), true);
  assert.equal(canAccessOnboardingVerificationStep("ACTIVE"), true);
  assert.equal(canAccessOnboardingVerificationStep("SUSPENDED"), false);
  assert.equal(canAccessOnboardingVerificationStep("BANNED"), false);
  assert.equal(canAccessOnboardingVerificationStep("DELETED"), false);
});

test("only ACTIVE can reach onboarding steps past verification", () => {
  assert.equal(canAccessOnboardingPostVerificationSteps("ACTIVE"), true);
  assert.equal(canAccessOnboardingPostVerificationSteps("PENDING_VERIFICATION"), false);
  assert.equal(canAccessOnboardingPostVerificationSteps("SUSPENDED"), false);
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
console.log(`\naccount-status.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
