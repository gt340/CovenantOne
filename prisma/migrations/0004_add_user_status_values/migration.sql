-- =============================================================================
-- 0004_add_user_status_values
-- Applied for real against CovenantOne. Adds what Phase 2 (auth/registration)
-- needs that Phase 1's schema didn't yet have.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Account status lifecycle: add PENDING_VERIFICATION (new accounts start
-- here, not ACTIVE) and DELETED (soft-delete terminal state distinct from
-- PENDING_DELETION, which is a grace-period state before deletion executes).
-- Postgres enum values can only be added, never removed in place — the two
-- statuses already unused by app code (DEACTIVATED_BY_USER,
-- PENDING_DELETION) are left in place rather than dropped, since dropping an
-- enum value requires recreating the type and everything referencing it.
-- -----------------------------------------------------------------------------
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'DELETED';
