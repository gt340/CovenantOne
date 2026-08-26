-- =============================================================================
-- 0006_enforce_status_transitions
-- Fixes a real gap found during Phase 2 review: the existing
-- `users_update_own_non_privileged_fields` RLS policy is row-level only (as
-- all RLS policies are) — it does not, and cannot by itself, stop a member
-- from updating their OWN `status` column to anything, including back to
-- ACTIVE from SUSPENDED/BANNED. The `role` field already had a trigger
-- guard (trg_enforce_role_assignment, migration 0002); `status` never did.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.enforce_status_transition_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- System auto-activation on email confirmation (migration 0005's
    -- handle_auth_user_email_confirmed trigger) — a known-safe, narrow
    -- transition that isn't reachable any other way, since PENDING_VERIFICATION
    -- is only ever set by the signup trigger itself, never by a user action.
    IF OLD.status = 'PENDING_VERIFICATION' AND NEW.status = 'ACTIVE' THEN
      RETURN NEW;
    END IF;

    -- Self-service account deletion is always allowed by the account owner.
    IF NEW.status = 'DELETED' AND auth.uid() = NEW.id THEN
      RETURN NEW;
    END IF;

    -- Every other transition (suspending, banning, reinstating, or a member
    -- trying to change their own status to anything else) requires
    -- safety-moderator tier or above.
    IF NOT private.is_safety_moderator_tier() THEN
      RAISE EXCEPTION 'Not authorized to change account status from % to %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_status_transition
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION private.enforce_status_transition_rules();
