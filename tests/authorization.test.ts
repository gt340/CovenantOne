import assert from "node:assert/strict";
import { Role } from "../src/lib/auth/roles";
import {
  canViewConversation,
  canSendMessageInConversation,
  canAccessReportedConversationContent,
  canViewContactInfo,
  canActOnModerationCase,
  canAssignRole,
} from "../src/lib/auth/authorization";

type TestFn = () => void;
const tests: [string, TestFn][] = [];
function test(name: string, fn: TestFn) {
  tests.push([name, fn]);
}

const conversation = { userAId: "user-1", userBId: "user-2" };

test("a participant can view their own conversation", () => {
  assert.equal(
    canViewConversation({ userId: "user-1", role: Role.MEMBER }, conversation),
    true
  );
  assert.equal(
    canViewConversation({ userId: "user-2", role: Role.MEMBER }, conversation),
    true
  );
});

test("a non-participant MEMBER cannot view someone else's conversation", () => {
  assert.equal(
    canViewConversation({ userId: "user-3", role: Role.MEMBER }, conversation),
    false
  );
});

test("a non-participant ADMIN still cannot view an arbitrary conversation via the plain read path", () => {
  // Role alone never grants conversation access — only the escrow flow does,
  // and only for conversations tied to an actual report (tested below).
  assert.equal(
    canViewConversation({ userId: "admin-1", role: Role.ADMIN }, conversation),
    false
  );
});

test("only a participant with SEND_MESSAGE permission can send in a conversation", () => {
  assert.equal(
    canSendMessageInConversation({ userId: "user-1", role: Role.MEMBER }, conversation),
    true
  );
  assert.equal(
    canSendMessageInConversation({ userId: "user-3", role: Role.MEMBER }, conversation),
    false
  );
});

test("SAFETY_MODERATOR can access reported conversation content only when assigned, case open, and conversation matches the report", () => {
  const actor = { userId: "safety-mod-1", role: Role.SAFETY_MODERATOR };

  assert.equal(
    canAccessReportedConversationContent(actor, {
      moderationCaseStatus: "INVESTIGATING",
      assignedModeratorId: "safety-mod-1",
      conversationBelongsToReportedUser: true,
    }),
    true
  );

  // not assigned to them
  assert.equal(
    canAccessReportedConversationContent(actor, {
      moderationCaseStatus: "INVESTIGATING",
      assignedModeratorId: "safety-mod-2",
      conversationBelongsToReportedUser: true,
    }),
    false
  );

  // case already closed
  assert.equal(
    canAccessReportedConversationContent(actor, {
      moderationCaseStatus: "CLOSED",
      assignedModeratorId: "safety-mod-1",
      conversationBelongsToReportedUser: true,
    }),
    false
  );

  // conversation isn't actually the one the report concerns
  assert.equal(
    canAccessReportedConversationContent(actor, {
      moderationCaseStatus: "OPEN",
      assignedModeratorId: "safety-mod-1",
      conversationBelongsToReportedUser: false,
    }),
    false
  );
});

test("a general MODERATOR (not SAFETY_MODERATOR) can never access reported conversation content", () => {
  const actor = { userId: "mod-1", role: Role.MODERATOR };
  assert.equal(
    canAccessReportedConversationContent(actor, {
      moderationCaseStatus: "OPEN",
      assignedModeratorId: "mod-1",
      conversationBelongsToReportedUser: true,
    }),
    false
  );
});

test("no role can view contact info through the general profile path, including SUPER_ADMIN", () => {
  assert.equal(canViewContactInfo({ userId: "u1", role: Role.MEMBER }, "u2"), false);
  assert.equal(canViewContactInfo({ userId: "a1", role: Role.ADMIN }, "u2"), false);
  assert.equal(
    canViewContactInfo({ userId: "sa1", role: Role.SUPER_ADMIN }, "u2"),
    false
  );
});

test("a moderator can only act on a case assigned to them; an admin can act on any case", () => {
  const modActor = { userId: "mod-1", role: Role.MODERATOR };
  assert.equal(
    canActOnModerationCase(modActor, { assignedModeratorId: "mod-1" }),
    true
  );
  assert.equal(
    canActOnModerationCase(modActor, { assignedModeratorId: "mod-2" }),
    false
  );

  const adminActor = { userId: "admin-1", role: Role.ADMIN };
  assert.equal(
    canActOnModerationCase(adminActor, { assignedModeratorId: "mod-2" }),
    true
  );
});

test("role assignment: only SUPER_ADMIN can assign ADMIN/SUPER_ADMIN; ADMIN can assign MODERATOR-tier roles", () => {
  const admin = { userId: "admin-1", role: Role.ADMIN };
  const superAdmin = { userId: "sa-1", role: Role.SUPER_ADMIN };
  const moderator = { userId: "mod-1", role: Role.MODERATOR };

  assert.equal(canAssignRole(admin, Role.MODERATOR), true);
  assert.equal(canAssignRole(admin, Role.SAFETY_MODERATOR), true);
  assert.equal(canAssignRole(admin, Role.ADMIN), false);
  assert.equal(canAssignRole(admin, Role.SUPER_ADMIN), false);

  assert.equal(canAssignRole(superAdmin, Role.ADMIN), true);
  assert.equal(canAssignRole(superAdmin, Role.SUPER_ADMIN), true);

  assert.equal(canAssignRole(moderator, Role.MODERATOR), false);
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
console.log(`\nauthorization.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
