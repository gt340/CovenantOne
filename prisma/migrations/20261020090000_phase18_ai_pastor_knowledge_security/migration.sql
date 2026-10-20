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
SET search_path TO 'public', 'private'
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

-- Once a source is approved/current, chunks are immutable. Changes must be
-- published as a new source version, then approved by a different administrator.
-- Allow FK-driven cascade deletion when a source itself is deleted.
CREATE OR REPLACE FUNCTION private.guard_approved_knowledge_chunk_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
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
