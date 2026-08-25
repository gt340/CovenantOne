import { Permission, Role } from "./roles";
import { hasPermission } from "./permissions";

// -----------------------------------------------------------------------------
// These functions take plain data (never a live DB connection) so they can be
// unit tested in isolation, and so the same logic can be reused server-side
// wherever a request needs an authorization decision. Role permissions alone
// are NOT sufficient for anything ownership-scoped (a message, a profile, a
// report) — every one of those checks the actor's relationship to the
// resource in addition to their role.
// -----------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  role: Role;
}

export interface ConversationParticipants {
  userAId: string;
  userBId: string;
}

/// A conversation's two participants may always read it. No one else may,
/// regardless of role — role-based conversation access only exists via the
/// explicit escrow flow below, which requires an open case, not just a badge.
export function canViewConversation(
  actor: ActorContext,
  conversation: ConversationParticipants
): boolean {
  return actor.userId === conversation.userAId || actor.userId === conversation.userBId;
}

export function canSendMessageInConversation(
  actor: ActorContext,
  conversation: ConversationParticipants
): boolean {
  return (
    hasPermission(actor.role, Permission.SEND_MESSAGE) &&
    canViewConversation(actor, conversation)
  );
}

export interface ModerationEscrowRequest {
  moderationCaseStatus: "OPEN" | "INVESTIGATING" | "ACTION_TAKEN" | "ESCALATED" | "CLOSED";
  assignedModeratorId: string | null;
  conversationBelongsToReportedUser: boolean; // the conversation must actually involve the reported user
}

/// Even a SAFETY_MODERATOR cannot read arbitrary conversation content. They
/// need: (a) the permission, (b) an open/investigating/escalated case
/// assigned to them, and (c) the conversation must actually be the one the
/// report concerns. Every successful call site must additionally write an
/// AuditLog row — see SECURITY.md "Reported conversation access".
export function canAccessReportedConversationContent(
  actor: ActorContext,
  escrow: ModerationEscrowRequest
): boolean {
  if (!hasPermission(actor.role, Permission.ACCESS_REPORTED_CONVERSATION_CONTENT)) {
    return false;
  }
  if (escrow.moderationCaseStatus === "CLOSED") {
    return false;
  }
  if (escrow.assignedModeratorId !== actor.userId) {
    return false;
  }
  if (!escrow.conversationBelongsToReportedUser) {
    return false;
  }
  return true;
}

/// Contact info (email, phone) is never returned by any "view profile" code
/// path, for any role. There is intentionally no bypass here, including for
/// ADMIN/SUPER_ADMIN — legitimate support needs (e.g. a subpoena, a support
/// ticket) go through a separate, explicitly logged export tool, not the
/// general profile read path. This function exists so the rule has one
/// canonical place instead of being re-decided ad hoc at each call site.
export function canViewContactInfo(_actor: ActorContext, _profileOwnerId: string): boolean {
  return false;
}

export interface OwnableResource {
  ownerId: string;
}

/// Generic "is this my own record" check used for profile sub-tables
/// (FaithProfile, LocationProfile, Education, etc.) plus a role permission.
export function canEditOwnResource(
  actor: ActorContext,
  resource: OwnableResource,
  permission: Permission
): boolean {
  return actor.userId === resource.ownerId && hasPermission(actor.role, permission);
}

export interface ModerationCaseAssignment {
  assignedModeratorId: string | null;
}

/// Resolving/acting on a moderation case requires both the permission AND
/// (for MODERATOR/SAFETY_MODERATOR) being the assigned handler — prevents one
/// moderator from closing out another's in-progress case. ADMIN/SUPER_ADMIN,
/// who also have ASSIGN_MODERATION_CASE, may act on any case since they're
/// the ones doing assignment/oversight.
export function canActOnModerationCase(
  actor: ActorContext,
  action: ModerationCaseAssignment
): boolean {
  const isElevatedAdmin =
    hasPermission(actor.role, Permission.ASSIGN_MODERATION_CASE);
  if (isElevatedAdmin) return true;
  const canHandleCases =
    hasPermission(actor.role, Permission.RESOLVE_MODERATION_CASE) ||
    hasPermission(actor.role, Permission.ESCALATE_MODERATION_CASE);
  return canHandleCases && action.assignedModeratorId === actor.userId;
}

/// Role changes have their own guard rails: only MANAGE_MODERATOR_ROLES can
/// grant MENTOR/MODERATOR/SAFETY_MODERATOR, and granting/revoking ADMIN or
/// SUPER_ADMIN requires MANAGE_ADMIN_ROLES (SUPER_ADMIN only). A caller can
/// never grant a role more privileged than the check allows.
export function canAssignRole(actor: ActorContext, targetRole: Role): boolean {
  const adminTierRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];
  if (adminTierRoles.includes(targetRole)) {
    return hasPermission(actor.role, Permission.MANAGE_ADMIN_ROLES);
  }
  return hasPermission(actor.role, Permission.MANAGE_MODERATOR_ROLES);
}
