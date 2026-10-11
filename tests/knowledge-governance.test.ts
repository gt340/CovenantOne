// Unit tests for the approval governance rules. No network, no database.
import assert from "node:assert/strict";
import { evaluateApproval, licenseChangeAudit } from "../src/lib/aiPastor/knowledgeGovernance";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}`); throw e; }
}

const base = { actorId: "admin-b", actorRole: "ADMIN", uploaderId: "admin-a", approvalStatus: "UNDER_REVIEW", licenseStatus: "LICENSE_VERIFIED" };

console.log("UNIT TEST — knowledge approval governance");

test("a different ADMIN may approve an UNDER_REVIEW source with a resolved licence", () => {
  assert.deepEqual(evaluateApproval(base), { allowed: true });
});

test("SUPER_ADMIN may approve another admin's source", () => {
  assert.equal(evaluateApproval({ ...base, actorRole: "SUPER_ADMIN" }).allowed, true);
});

test("uploader self-approval is denied (403 SELF_APPROVAL_FORBIDDEN), even for SUPER_ADMIN", () => {
  for (const role of ["ADMIN", "SUPER_ADMIN"]) {
    const d = evaluateApproval({ ...base, actorId: "admin-a", actorRole: role });
    assert.equal(d.allowed, false);
    if (!d.allowed) { assert.equal(d.status, 403); assert.equal(d.code, "SELF_APPROVAL_FORBIDDEN"); }
  }
});

test("non-admin roles and missing roles are denied (403 FORBIDDEN)", () => {
  for (const role of ["MEMBER", "MENTOR", "MODERATOR", "SAFETY_MODERATOR", "", null, undefined]) {
    const d = evaluateApproval({ ...base, actorRole: role as any });
    assert.equal(d.allowed, false, String(role));
    if (!d.allowed) { assert.equal(d.status, 403); assert.equal(d.code, "FORBIDDEN"); }
  }
});

test("authorization is checked before anything about the source is revealed", () => {
  const d = evaluateApproval({ ...base, actorRole: "MEMBER", approvalStatus: "DRAFT", licenseStatus: "RESTRICTED" });
  assert.equal(d.allowed === false && d.code, "FORBIDDEN");
});

test("only UNDER_REVIEW can be approved (DRAFT, APPROVED, REJECTED, ARCHIVED -> 409)", () => {
  for (const s of ["DRAFT", "APPROVED", "REJECTED", "ARCHIVED"]) {
    const d = evaluateApproval({ ...base, approvalStatus: s });
    assert.equal(d.allowed === false && d.status, 409, s);
  }
});

test("unresolved or restricted licences block approval; resolved ones do not", () => {
  for (const l of ["LICENSE_UNKNOWN", "LICENSE_REQUIRES_REVIEW", "RESTRICTED"]) {
    const d = evaluateApproval({ ...base, licenseStatus: l });
    assert.equal(d.allowed === false && d.code, "LICENSE_BLOCKED", l);
  }
  for (const l of ["LICENSE_VERIFIED", "PUBLIC_DOMAIN", "OTHER_APPROVED_STATUS"]) {
    assert.equal(evaluateApproval({ ...base, licenseStatus: l }).allowed, true, l);
  }
});

test("self-approval is reported before licence problems (no licence workaround reveals a path)", () => {
  const d = evaluateApproval({ ...base, actorId: "admin-a", licenseStatus: "LICENSE_UNKNOWN" });
  assert.equal(d.allowed === false && d.code, "SELF_APPROVAL_FORBIDDEN");
});

test("licence audit: no entry when unchanged or unspecified", () => {
  assert.equal(licenseChangeAudit("LICENSE_UNKNOWN", undefined), null);
  assert.equal(licenseChangeAudit("LICENSE_UNKNOWN", "LICENSE_UNKNOWN"), null);
});

test("licence audit: records from/to and whether the change asserts clearance", () => {
  assert.deepEqual(licenseChangeAudit("LICENSE_REQUIRES_REVIEW", "LICENSE_VERIFIED"), { from: "LICENSE_REQUIRES_REVIEW", to: "LICENSE_VERIFIED", assertsClearance: true });
  assert.deepEqual(licenseChangeAudit("LICENSE_VERIFIED", "RESTRICTED"), { from: "LICENSE_VERIFIED", to: "RESTRICTED", assertsClearance: false });
});

console.log(`\n${passed} governance tests passed`);
