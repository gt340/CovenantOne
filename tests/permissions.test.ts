import assert from "node:assert/strict";
import { Role, ALL_ROLES, Permission } from "../src/lib/auth/roles";
import { hasPermission, permissionsForRole } from "../src/lib/auth/permissions";

type TestFn = () => void;
const tests: [string, TestFn][] = [];
function test(name: string, fn: TestFn) {
  tests.push([name, fn]);
}

test("MEMBER can send messages and file reports", () => {
  assert.equal(hasPermission(Role.MEMBER, Permission.SEND_MESSAGE), true);
  assert.equal(hasPermission(Role.MEMBER, Permission.FILE_REPORT), true);
});

test("MEMBER cannot access reported conversation content", () => {
  assert.equal(
    hasPermission(Role.MEMBER, Permission.ACCESS_REPORTED_CONVERSATION_CONTENT),
    false
  );
});

test("MODERATOR cannot access reported conversation content (needs SAFETY_MODERATOR+)", () => {
  assert.equal(
    hasPermission(Role.MODERATOR, Permission.ACCESS_REPORTED_CONVERSATION_CONTENT),
    false
  );
  assert.equal(hasPermission(Role.MODERATOR, Permission.BAN_ACCOUNT), false);
});

test("SAFETY_MODERATOR can access reported conversation content and ban", () => {
  assert.equal(
    hasPermission(Role.SAFETY_MODERATOR, Permission.ACCESS_REPORTED_CONVERSATION_CONTENT),
    true
  );
  assert.equal(hasPermission(Role.SAFETY_MODERATOR, Permission.BAN_ACCOUNT), true);
});

test("SAFETY_MODERATOR cannot manage admin roles or view audit log", () => {
  assert.equal(hasPermission(Role.SAFETY_MODERATOR, Permission.MANAGE_ADMIN_ROLES), false);
  assert.equal(hasPermission(Role.SAFETY_MODERATOR, Permission.VIEW_AUDIT_LOG), false);
});

test("ADMIN can view audit log and manage moderator roles, but not admin roles", () => {
  assert.equal(hasPermission(Role.ADMIN, Permission.VIEW_AUDIT_LOG), true);
  assert.equal(hasPermission(Role.ADMIN, Permission.MANAGE_MODERATOR_ROLES), true);
  assert.equal(hasPermission(Role.ADMIN, Permission.MANAGE_ADMIN_ROLES), false);
});

test("only SUPER_ADMIN can manage admin roles", () => {
  for (const role of ALL_ROLES) {
    const expected = role === Role.SUPER_ADMIN;
    assert.equal(
      hasPermission(role, Permission.MANAGE_ADMIN_ROLES),
      expected,
      `Role ${role} MANAGE_ADMIN_ROLES should be ${expected}`
    );
  }
});

test("every role has a non-empty, deduplicated permission set", () => {
  for (const role of ALL_ROLES) {
    const perms = permissionsForRole(role);
    assert.ok(perms.length > 0, `${role} should have at least one permission`);
    assert.equal(
      new Set(perms).size,
      perms.length,
      `${role} permission list should not contain duplicates`
    );
  }
});

test("permission tiers are strictly additive: MEMBER ⊆ MENTOR/MODERATOR, MODERATOR ⊆ SAFETY_MODERATOR ⊆ ADMIN ⊆ SUPER_ADMIN", () => {
  const memberSet = new Set(permissionsForRole(Role.MEMBER));
  const mentorSet = new Set(permissionsForRole(Role.MENTOR));
  const moderatorSet = new Set(permissionsForRole(Role.MODERATOR));
  const safetySet = new Set(permissionsForRole(Role.SAFETY_MODERATOR));
  const adminSet = new Set(permissionsForRole(Role.ADMIN));
  const superAdminSet = new Set(permissionsForRole(Role.SUPER_ADMIN));

  for (const p of memberSet) assert.ok(mentorSet.has(p), `MENTOR missing ${p}`);
  for (const p of memberSet) assert.ok(moderatorSet.has(p), `MODERATOR missing ${p}`);
  for (const p of moderatorSet) assert.ok(safetySet.has(p), `SAFETY_MODERATOR missing ${p}`);
  for (const p of safetySet) assert.ok(adminSet.has(p), `ADMIN missing ${p}`);
  for (const p of adminSet) assert.ok(superAdminSet.has(p), `SUPER_ADMIN missing ${p}`);
});

// --- Test runner (no external framework needed) --------------------------
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
console.log(`\npermissions.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
