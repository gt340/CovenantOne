-- =============================================================================
-- 0005_phase2_auth_onboarding
-- Depends on 0004 (PENDING_VERIFICATION/DELETED must already be committed
-- enum values — Postgres won't let a new enum value be used in the same
-- transaction that added it).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New accounts now start PENDING_VERIFICATION, not ACTIVE. Overwrites the
-- Phase 1 version of this function (same signature, same trigger already
-- attached — CREATE OR REPLACE is sufficient, no need to touch the trigger).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, role, status)
  VALUES (NEW.id, 'MEMBER', 'PENDING_VERIFICATION')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Auto-promote PENDING_VERIFICATION -> ACTIVE the moment Supabase Auth marks
-- the email confirmed. Only fires that transition if the account is still in
-- PENDING_VERIFICATION — never overrides SUSPENDED/BANNED/DELETED, so a
-- suspended member re-confirming an email (e.g. a stale link) can't
-- accidentally reactivate themselves.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.handle_auth_user_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.users
    SET status = 'ACTIVE', "updatedAt" = now()
    WHERE id = NEW.id AND status = 'PENDING_VERIFICATION';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_auth_user_email_confirmed();

-- -----------------------------------------------------------------------------
-- Marital status — required registration field (Phase 2), missing from the
-- Phase 1 schema. Flagging as a real omission fixed here, not silently
-- patched without note (see PHASE2_REPORT.md).
-- -----------------------------------------------------------------------------
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'DIVORCED', 'WIDOWED', 'SEPARATED');

ALTER TABLE "member_profiles"
  ADD COLUMN "maritalStatus" "MaritalStatus" NOT NULL DEFAULT 'SINGLE';

-- Default above exists only so the ADD COLUMN succeeds against a table that
-- could already have rows; the application always sets this explicitly at
-- registration and should never rely on the default.
ALTER TABLE "member_profiles" ALTER COLUMN "maritalStatus" DROP DEFAULT;

-- -----------------------------------------------------------------------------
-- 18+ eligibility, enforced at the database layer as defense-in-depth
-- alongside the application-level check in registration validation. Uses
-- CURRENT_DATE, which Postgres explicitly permits in CHECK constraints
-- (evaluated at each INSERT/UPDATE, not baked in at constraint-creation time).
-- -----------------------------------------------------------------------------
ALTER TABLE "member_profiles"
  ADD CONSTRAINT "chk_member_profiles_min_age"
  CHECK ("dateOfBirth" <= (CURRENT_DATE - INTERVAL '18 years'));

-- -----------------------------------------------------------------------------
-- Phone verification — reintroduced, but scoped narrowly: this is a
-- trust/safety signal on the member's profile (matches product principle:
-- "Prevent duplicate phone numbers"), not a Supabase Auth login method. Email
-- + password remains the sole authentication path; this table never touches
-- auth.users.
-- -----------------------------------------------------------------------------
CREATE TABLE "phone_verifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "phoneE164" TEXT NOT NULL UNIQUE,
  "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "otpCodeHash" TEXT,
  "otpExpiresAt" TIMESTAMPTZ,
  "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "phone_verifications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "phone_verifications_select_own" ON "phone_verifications" FOR SELECT
  USING ("userId" = auth.uid());
CREATE POLICY "phone_verifications_insert_own" ON "phone_verifications" FOR INSERT
  WITH CHECK ("userId" = auth.uid());
CREATE POLICY "phone_verifications_update_own" ON "phone_verifications" FOR UPDATE
  USING ("userId" = auth.uid());
CREATE POLICY "phone_verifications_safety_tier" ON "phone_verifications" FOR ALL
  USING (private.is_safety_moderator_tier());
