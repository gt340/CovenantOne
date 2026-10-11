-- Phase 18: two-person rule for knowledge-source approval, enforced in the
-- database so no caller (route, service-role script, direct SQL) can bypass it.
--
-- Replaces private.on_knowledge_source_approved(). Behaviour is unchanged
-- except that the transition to APPROVED now requires:
--   1. reviewedByUserId is set in the same UPDATE          -> REVIEWER_REQUIRED
--   2. reviewer is not the version's uploader/author       -> SELF_APPROVAL_FORBIDDEN
--   3. reviewer currently holds ADMIN or SUPER_ADMIN       -> REVIEWER_NOT_AUTHORIZED
--
-- NOT YET APPLIED TO PRODUCTION. Requires explicit authorization.
-- Operational note: after this applies, a source can only be approved when at
-- least TWO distinct ADMIN/SUPER_ADMIN accounts exist.

CREATE OR REPLACE FUNCTION private.on_knowledge_source_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF NEW."approvalStatus" = 'APPROVED' AND (OLD."approvalStatus" IS DISTINCT FROM 'APPROVED') THEN
    IF NEW."reviewedByUserId" IS NULL THEN
      RAISE EXCEPTION 'REVIEWER_REQUIRED: approval must record the approving administrator';
    END IF;
    IF NEW."reviewedByUserId" = NEW."uploaderUserId" THEN
      RAISE EXCEPTION 'SELF_APPROVAL_FORBIDDEN: the author of a source version cannot approve it';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = NEW."reviewedByUserId" AND u.role IN ('ADMIN','SUPER_ADMIN')
    ) THEN
      RAISE EXCEPTION 'REVIEWER_NOT_AUTHORIZED: approver must be an ADMIN or SUPER_ADMIN';
    END IF;

    UPDATE knowledge_sources
      SET "isCurrentProduction" = false
      WHERE "lineageId" = NEW."lineageId" AND id <> NEW.id AND "isCurrentProduction" = true;
    NEW."isCurrentProduction" := true;
    NEW."reviewedAt" := now();
  ELSIF NEW."approvalStatus" IN ('REJECTED','ARCHIVED') AND OLD."approvalStatus" IS DISTINCT FROM NEW."approvalStatus" THEN
    NEW."isCurrentProduction" := false;
    IF NEW."approvalStatus" = 'ARCHIVED' THEN NEW."archivedAt" := now(); END IF;
    IF NEW."approvalStatus" = 'REJECTED' THEN NEW."reviewedAt" := now(); END IF;
  END IF;
  RETURN NEW;
END $function$;
