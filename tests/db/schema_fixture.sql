-- CI-only fixture: recreates the objects the Phase 18 database tests need, as
-- they exist in production BEFORE the self-approval migration. Production
-- definitions were read from the live database; Supabase-specific pieces
-- (auth.uid, roles) are minimal stand-ins. The real migration under
-- prisma/migrations/ is applied on top of this file by tests/db/run.sh, so the
-- tests exercise the actual migration SQL, not a copy.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif((nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'), '')::uuid
$$;

CREATE TYPE "Role" AS ENUM ('MEMBER','MENTOR','MODERATOR','SAFETY_MODERATOR','ADMIN','SUPER_ADMIN');
CREATE TYPE "KnowledgeSourceType" AS ENUM ('BIBLE_API','BIBLE_DATASET','SERMON','TEACHING','ARTICLE','BOOK','COURSE','STUDY_GUIDE','COVENANTONE_DOCUMENT','FAQ','POLICY','OTHER_APPROVED_SOURCE');
CREATE TYPE "KnowledgeApprovalStatus" AS ENUM ('DRAFT','UNDER_REVIEW','APPROVED','REJECTED','ARCHIVED');
CREATE TYPE "KnowledgeLicenseStatus" AS ENUM ('LICENSE_VERIFIED','LICENSE_UNKNOWN','LICENSE_REQUIRES_REVIEW','RESTRICTED','PUBLIC_DOMAIN','OTHER_APPROVED_STATUS');
CREATE TYPE "KnowledgeTrustLevel" AS ENUM ('OFFICIAL','VERIFIED','COMMUNITY','UNVERIFIED');
CREATE TYPE "KnowledgeVisibility" AS ENUM ('MEMBER_FACING','ADMIN_ONLY');
CREATE TYPE "KnowledgeEmbeddingStatus" AS ENUM ('NOT_REQUESTED','PENDING','UNAVAILABLE');

CREATE TABLE public.users (id uuid PRIMARY KEY, role "Role" NOT NULL DEFAULT 'MEMBER');

CREATE OR REPLACE FUNCTION private.current_user_role() RETURNS "Role" LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;
CREATE OR REPLACE FUNCTION private.is_admin_tier() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT private.current_user_role() IN ('ADMIN','SUPER_ADMIN');
$$;

CREATE TABLE public.knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "lineageId" uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  "supersedesId" uuid REFERENCES public.knowledge_sources(id) ON DELETE SET NULL,
  "isCurrentProduction" boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  author text,
  organization text,
  "sourceType" "KnowledgeSourceType" NOT NULL,
  description text,
  language text NOT NULL DEFAULT 'en',
  "publicationDate" date,
  "copyrightInfo" text,
  "licenseStatus" "KnowledgeLicenseStatus" NOT NULL DEFAULT 'LICENSE_REQUIRES_REVIEW',
  "licenseNotes" text,
  "sourceUrl" text,
  "trustLevel" "KnowledgeTrustLevel" NOT NULL DEFAULT 'UNVERIFIED',
  visibility "KnowledgeVisibility" NOT NULL DEFAULT 'MEMBER_FACING',
  "rawContent" text NOT NULL,
  "contentCharCount" integer NOT NULL DEFAULT 0,
  "approvalStatus" "KnowledgeApprovalStatus" NOT NULL DEFAULT 'DRAFT',
  "rejectionReason" text,
  "reviewedByUserId" uuid REFERENCES public.users(id),
  "reviewedAt" timestamptz,
  "archivedAt" timestamptz,
  "uploaderUserId" uuid NOT NULL REFERENCES public.users(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_sources_one_production_per_lineage ON public.knowledge_sources ("lineageId") WHERE ("isCurrentProduction" = true);

CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sourceId" uuid NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  "chunkIndex" integer NOT NULL,
  content text NOT NULL,
  "charCount" integer NOT NULL,
  "contentTsv" tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, content)) STORED,
  "embeddingStatus" "KnowledgeEmbeddingStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("sourceId", "chunkIndex")
);
CREATE INDEX knowledge_chunks_tsv_idx ON public.knowledge_chunks USING gin ("contentTsv");

CREATE TABLE public.ai_pastor_retrieval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid REFERENCES public.users(id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('CHAT','ADMIN_TEST')),
  "questionHash" text NOT NULL,
  "questionText" text,
  topic text,
  "consideredCount" integer NOT NULL DEFAULT 0,
  selected jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_pastor_conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES public.users(id), title text);
CREATE TABLE public.ai_pastor_memory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES public.users(id), content text NOT NULL);

-- Triggers: production definition BEFORE the self-approval migration.
CREATE OR REPLACE FUNCTION private.on_knowledge_source_approved() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private' AS $function$
BEGIN
  IF NEW."approvalStatus" = 'APPROVED' AND (OLD."approvalStatus" IS DISTINCT FROM 'APPROVED') THEN
    UPDATE knowledge_sources SET "isCurrentProduction" = false
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
CREATE TRIGGER trg_knowledge_source_approval BEFORE UPDATE ON public.knowledge_sources FOR EACH ROW EXECUTE FUNCTION private.on_knowledge_source_approved();

CREATE OR REPLACE FUNCTION public.search_approved_knowledge(p_query text, p_limit integer DEFAULT 4, p_include_admin_only boolean DEFAULT false)
RETURNS TABLE("chunkId" uuid, "sourceId" uuid, title text, author text, "sourceType" "KnowledgeSourceType", "trustLevel" "KnowledgeTrustLevel",
  "chunkIndex" integer, content text, rank real, version integer, "licenseStatus" "KnowledgeLicenseStatus", "approvalStatus" "KnowledgeApprovalStatus")
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, s.id, s.title, s.author, s."sourceType", s."trustLevel", c."chunkIndex", c.content,
         ts_rank(c."contentTsv", plainto_tsquery('english', p_query)), s.version, s."licenseStatus", s."approvalStatus"
  FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c."sourceId"
  WHERE s."isCurrentProduction" = true AND s."approvalStatus" = 'APPROVED' AND s."archivedAt" IS NULL
    AND s."licenseStatus" NOT IN ('LICENSE_UNKNOWN','LICENSE_REQUIRES_REVIEW','RESTRICTED')
    AND (p_include_admin_only OR s.visibility = 'MEMBER_FACING')
    AND c."contentTsv" @@ plainto_tsquery('english', p_query)
  ORDER BY ts_rank(c."contentTsv", plainto_tsquery('english', p_query)) DESC
  LIMIT least(greatest(p_limit, 1), 10);
$$;
REVOKE ALL ON FUNCTION public.search_approved_knowledge(text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_approved_knowledge(text, integer, boolean) TO service_role;

-- RLS exactly as production.
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pastor_retrieval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pastor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pastor_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_sources_admin_all ON public.knowledge_sources FOR ALL USING (private.is_admin_tier()) WITH CHECK (private.is_admin_tier());
CREATE POLICY knowledge_chunks_admin_all ON public.knowledge_chunks FOR ALL USING (private.is_admin_tier()) WITH CHECK (private.is_admin_tier());
CREATE POLICY ai_pastor_retrieval_events_admin_select ON public.ai_pastor_retrieval_events FOR SELECT USING (private.is_admin_tier());
CREATE POLICY ai_pastor_conversations_own ON public.ai_pastor_conversations FOR ALL USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY ai_pastor_conversations_admin ON public.ai_pastor_conversations FOR SELECT USING (private.is_admin_tier());
CREATE POLICY ai_pastor_memory_own ON public.ai_pastor_memory FOR ALL USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());

GRANT USAGE ON SCHEMA public, private, auth TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION private.current_user_role(), private.is_admin_tier() TO authenticated, service_role;
