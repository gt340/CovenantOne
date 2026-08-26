import assert from "node:assert/strict";
import { isAtLeast18, calculateAge, classifyDirectory } from "../src/lib/domain/eligibility";

type TestFn = () => void;
const tests: [string, TestFn][] = [];
function test(name: string, fn: TestFn) {
  tests.push([name, fn]);
}

const REFERENCE_DATE = new Date("2026-08-25T00:00:00Z");

test("exactly 18 years old today counts as eligible", () => {
  const dob = new Date("2008-08-25T00:00:00Z");
  assert.equal(isAtLeast18(dob, REFERENCE_DATE), true);
});

test("18th birthday is tomorrow — not yet eligible", () => {
  const dob = new Date("2008-08-26T00:00:00Z");
  assert.equal(isAtLeast18(dob, REFERENCE_DATE), false);
});

test("17 years old is not eligible", () => {
  const dob = new Date("2009-01-01T00:00:00Z");
  assert.equal(isAtLeast18(dob, REFERENCE_DATE), false);
});

test("clearly an adult (40 years old) is eligible", () => {
  const dob = new Date("1986-03-15T00:00:00Z");
  assert.equal(isAtLeast18(dob, REFERENCE_DATE), true);
});

test("calculateAge matches isAtLeast18 at the boundary", () => {
  const dob = new Date("2008-08-25T00:00:00Z");
  assert.equal(calculateAge(dob, REFERENCE_DATE), 18);
  const dobTooYoung = new Date("2008-08-26T00:00:00Z");
  assert.equal(calculateAge(dobTooYoung, REFERENCE_DATE), 17);
});

test("classifyDirectory maps MALE to MEN and FEMALE to WOMEN", () => {
  assert.equal(classifyDirectory("MALE"), "MEN");
  assert.equal(classifyDirectory("FEMALE"), "WOMEN");
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
console.log(`\neligibility.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
