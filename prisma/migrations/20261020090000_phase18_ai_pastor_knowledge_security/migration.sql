-- Review-only security hardening for AI Pastor privacy and Knowledge Center integrity.
-- Apply only after reconciling the live Phase 16/17 migration with repository history.
-- No production application is authorized by this file being present in Git.
--
-- Private AI Pastor conversations/messages are owner-only. Admin moderation, if
-- needed, must use a separately designed and audited access path.
DROP POLICY IF EXISTS ai_pastor_conversations_admin ON public.ai_pastor_conversations;
DROP POLICY IF EXISTS ai_pastor_messages_admin ON public.ai_pastor_messages;

-- Direct INSERT must not be able to bypass the review-transition trigger.
CREATE OR REPLACE FUNCTION private.guard_knowledge_source_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
BEGIN
  IF NEW."approvalStatus" = 'APPROVED' OR NEW."isCurrentProduction" = true THEN
    RAISE EXCEPTION 'SOURCE_REVIEW_REQUIRED: new sources must be created outside production and approved through the review transition';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_knowledge_source_insert_guard ON public.knowledge_sources;
CREATE TRIGGER trg_knowledge_source_insert_guard
  BEFORE INSERT ON public.knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION private.guard_knowledge_source_insert();



-- Protect approved/current source rows themselves, not only their chunks.
-- The only permitted in-place mutation of a protected source is the internal
-- retirement of its production flag when a newer version is approved by the
-- existing approval trigger. All content changes must create a new version.
CREATE OR REPLACE FUNCTION private.guard_approved_knowledge_source_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."approvalStatus" = 'APPROVED' OR OLD."isCurrentProduction" = true THEN
      RAISE EXCEPTION 'APPROVED_SOURCE_IMMUTABLE: approved/current knowledge sources cannot be deleted; create a new version instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."approvalStatus" = 'APPROVED' OR OLD."isCurrentProduction" = true THEN
    -- Preserve the existing archive lifecycle, but permit no content/provenance
    -- edits alongside it. The established approval trigger sets archive metadata.
    IF NEW."approvalStatus" = 'ARCHIVED'
       AND (to_jsonb(NEW) - ARRAY['approvalStatus','isCurrentProduction','updatedAt','archivedAt','reviewedAt'])
           = (to_jsonb(OLD) - ARRAY['approvalStatus','isCurrentProduction','updatedAt','archivedAt','reviewedAt']) THEN
      RETURN NEW;
    END IF;

    -- The existing approval trigger may retire an older version internally.
    IF pg_catalog.pg_trigger_depth() > 1
       AND OLD."isCurrentProduction" = true
       AND NEW."isCurrentProduction" = false
       AND (to_jsonb(NEW) - ARRAY['isCurrentProduction','updatedAt'])
           = (to_jsonb(OLD) - ARRAY['isCurrentProduction','updatedAt']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'APPROVED_SOURCE_IMMUTABLE: approved/current knowledge sources cannot be edited in place; create a new version instead';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_approved_knowledge_source_mutation ON public.knowledge_sources;
CREATE TRIGGER trg_guard_approved_knowledge_source_mutation
  BEFORE UPDATE OR DELETE ON public.knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION private.guard_approved_knowledge_source_mutation();

-- Prevent an UPDATE from directly promoting an unapproved source by toggling
-- isCurrentProduction without performing the guarded APPROVED transition.
CREATE OR REPLACE FUNCTION private.guard_knowledge_source_current_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
BEGIN
  IF NEW."isCurrentProduction" = true
     AND OLD."isCurrentProduction" IS DISTINCT FROM true
     AND OLD."approvalStatus" IS NOT DISTINCT FROM NEW."approvalStatus" THEN
    RAISE EXCEPTION 'SOURCE_REVIEW_REQUIRED: production eligibility must be established by the guarded approval transition';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_knowledge_source_current_flag ON public.knowledge_sources;
CREATE TRIGGER trg_guard_knowledge_source_current_flag
  BEFORE UPDATE ON public.knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION private.guard_knowledge_source_current_flag();

-- Once a source is approved/current, chunks are immutable. Changes must be
-- published as a new source version, then approved by a different administrator.
-- Allow FK-driven cascade deletion when a source itself is deleted.
CREATE OR REPLACE FUNCTION private.guard_approved_knowledge_chunk_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  old_source_protected boolean := false;
  new_source_protected boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT (s."approvalStatus" = 'APPROVED' OR s."isCurrentProduction" = true)
      INTO old_source_protected
      FROM public.knowledge_sources s WHERE s.id = OLD."sourceId";
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT (s."approvalStatus" = 'APPROVED' OR s."isCurrentProduction" = true)
      INTO new_source_protected
      FROM public.knowledge_sources s WHERE s.id = NEW."sourceId";
  END IF;

  IF COALESCE(old_source_protected, false)
     OR COALESCE(new_source_protected, false) THEN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'APPROVED_SOURCE_CHUNKS_IMMUTABLE: create and approve a new source version to change production knowledge';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_approved_knowledge_chunk_mutation ON public.knowledge_chunks;
CREATE TRIGGER trg_guard_approved_knowledge_chunk_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION private.guard_approved_knowledge_chunk_mutation();
