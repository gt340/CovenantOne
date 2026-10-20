-- CI-only setup for the review-only security hardening migration.
-- Models the live AI Pastor message table and the permissive policies found in staging.
CREATE TABLE public.ai_pastor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversationId" uuid NOT NULL REFERENCES public.ai_pastor_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  classification text,
  "scriptureRefs" jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_pastor_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_pastor_messages_own ON public.ai_pastor_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.ai_pastor_conversations c
      WHERE c.id = "ai_pastor_messages"."conversationId"
        AND c."userId" = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_pastor_conversations c
      WHERE c.id = "ai_pastor_messages"."conversationId"
        AND c."userId" = auth.uid()
    )
  );
CREATE POLICY ai_pastor_messages_admin ON public.ai_pastor_messages
  FOR SELECT USING (private.is_admin_tier());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_pastor_messages TO authenticated, service_role;
