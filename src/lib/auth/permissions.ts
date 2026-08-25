import { Permission, Role } from "./roles";

// -----------------------------------------------------------------------------
// ROLE -> PERMISSION MATRIX
// -----------------------------------------------------------------------------
// Deliberately explicit and additive per tier rather than one giant flat list,
// so it's easy to audit "what can a MODERATOR do that a MEMBER can't" at a
// glance. No role implicitly inherits SUPER_ADMIN-only permissions.
// -----------------------------------------------------------------------------

const MEMBER_PERMISSIONS: Permission[] = [
  Permission.VIEW_OWN_PROFILE,
  Permission.EDIT_OWN_PROFILE,
  Permission.SEND_INTRODUCTION_REQUEST,
  Permission.SEND_MESSAGE,
  Permission.INITIATE_CALL,
  Permission.FILE_REPORT,
  Permission.BLOCK_USER,
  Permission.INVITE_FAMILY_MENTOR,
  Permission.CREATE_COMMUNITY_POST,
  Permission.REQUEST_MENTORSHIP,
  Permission.ORGANIZE_FUNDRAISER,
  Permission.DONATE,
];

const MENTOR_PERMISSIONS: Permission[] = [
  ...MEMBER_PERMISSIONS,
  Permission.ACCEPT_MENTORSHIP_REQUEST,
  Permission.VIEW_MENTEE_STAGE_SUMMARY,
];

// General moderator: handles community content and low-severity cases.
// Explicitly does NOT get conversation-content access or ban authority —
// that is reserved for SAFETY_MODERATOR and above.
const MODERATOR_PERMISSIONS: Permission[] = [
  ...MEMBER_PERMISSIONS,
  Permission.VIEW_REPORTED_CONTENT_METADATA,
  Permission.REMOVE_COMMUNITY_CONTENT,
  Permission.ISSUE_WARNING,
  Permission.RESOLVE_MODERATION_CASE,
];

// Safety moderator: the elevated tier for safeguarding-relevant cases
// (harassment, sexual solicitation, underage concerns, scams). This is the
// only sub-admin role that can open the reported-conversation escrow flow.
const SAFETY_MODERATOR_PERMISSIONS: Permission[] = [
  ...MODERATOR_PERMISSIONS,
  Permission.ACCESS_REPORTED_CONVERSATION_CONTENT,
  Permission.SUSPEND_ACCOUNT,
  Permission.BAN_ACCOUNT,
  Permission.REINSTATE_ACCOUNT,
  Permission.ESCALATE_MODERATION_CASE,
  Permission.REVIEW_IDENTITY_VERIFICATION,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...SAFETY_MODERATOR_PERMISSIONS,
  Permission.APPROVE_MENTOR_STATUS,
  Permission.APPROVE_FUNDRAISING_CAMPAIGN,
  Permission.APPROVE_FUND_DISBURSEMENT,
  Permission.MANAGE_EVENTS,
  Permission.MANAGE_JOBS,
  Permission.VIEW_AUDIT_LOG,
  Permission.ASSIGN_MODERATION_CASE,
  Permission.MANAGE_MODERATOR_ROLES,
  Permission.VIEW_PLATFORM_ANALYTICS,
];

// SUPER_ADMIN adds only what genuinely should not be given to ordinary admins:
// the ability to grant/revoke ADMIN itself. Everything else is identical to
// ADMIN — SUPER_ADMIN is not "ADMIN plus a blank check".
const SUPER_ADMIN_PERMISSIONS: Permission[] = [
  ...ADMIN_PERMISSIONS,
  Permission.MANAGE_ADMIN_ROLES,
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.MEMBER]: MEMBER_PERMISSIONS,
  [Role.MENTOR]: MENTOR_PERMISSIONS,
  [Role.MODERATOR]: MODERATOR_PERMISSIONS,
  [Role.SAFETY_MODERATOR]: SAFETY_MODERATOR_PERMISSIONS,
  [Role.ADMIN]: ADMIN_PERMISSIONS,
  [Role.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}
