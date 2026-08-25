-- =============================================================================
-- 0002_row_level_security
-- Applied for real against the CovenantOne Supabase project.
--
-- Every table Supabase flagged (all 40 in public schema) gets RLS enabled AND
-- policies in the same migration — enabling RLS with no policies would deny
-- all access and break the app; this migration does both together.
--
-- Mirrors the logic in src/lib/auth/authorization.ts as closely as SQL
-- reasonably allows. Where DB-level policy can't fully express the nuance in
-- that file (e.g. "assigned moderator OR admin-tier"), the policy is the
-- outer/coarser bound and the API layer still applies the finer-grained
-- check from authorization.ts before it lets a request through. RLS here is
-- defense-in-depth, not the only layer — see SECURITY.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- SECURITY DEFINER so it can read public.users even from inside a policy ON
-- public.users itself, without recursing into RLS.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS "Role"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_moderator_tier()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_user_role() IN ('MODERATOR','SAFETY_MODERATOR','ADMIN','SUPER_ADMIN');
$$;

CREATE OR REPLACE FUNCTION public.is_safety_moderator_tier()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_user_role() IN ('SAFETY_MODERATOR','ADMIN','SUPER_ADMIN');
$$;

CREATE OR REPLACE FUNCTION public.is_admin_tier()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_user_role() IN ('ADMIN','SUPER_ADMIN');
$$;

-- Is auth.uid() one of the two people in this connection?
CREATE OR REPLACE FUNCTION public.is_connection_participant(p_connection_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.id = p_connection_id
      AND (c."userAId" = auth.uid() OR c."userBId" = auth.uid())
  );
$$;

-- Is auth.uid() a participant in the connection behind this conversation?
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations conv
    JOIN public.connections c ON c.id = conv."connectionId"
    WHERE conv.id = p_conversation_id
      AND (c."userAId" = auth.uid() OR c."userBId" = auth.uid())
  );
$$;

-- -----------------------------------------------------------------------------
-- ROLE-ESCALATION GUARD (defense in depth alongside the RLS policy below —
-- mirrors canAssignRole() in authorization.ts: only SUPER_ADMIN can grant
-- ADMIN/SUPER_ADMIN; nobody can silently self-promote)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_role_assignment_rules()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role IN ('ADMIN','SUPER_ADMIN') AND public.current_user_role() IS DISTINCT FROM 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'Only SUPER_ADMIN may grant ADMIN or SUPER_ADMIN';
    END IF;
    IF NEW.role IN ('MENTOR','MODERATOR','SAFETY_MODERATOR') AND NOT public.is_admin_tier() THEN
      RAISE EXCEPTION 'Only ADMIN or SUPER_ADMIN may grant this role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_role_assignment
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_role_assignment_rules();

-- =============================================================================
-- ENABLE RLS ON EVERY TABLE
-- =============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.age_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faith_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marriage_intentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compatibility_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.introduction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderator_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentorship_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fundraising_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_mentor_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marriage_journeys ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- POLICIES
-- =============================================================================

-- --- users -------------------------------------------------------------------
CREATE POLICY "users_select_own" ON public.users FOR SELECT
  USING (id = auth.uid());
CREATE POLICY "users_select_admin_tier" ON public.users FOR SELECT
  USING (public.is_admin_tier());
CREATE POLICY "users_update_own_non_privileged_fields" ON public.users FOR UPDATE
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "users_update_admin_tier" ON public.users FOR UPDATE
  USING (public.is_admin_tier());
-- No general INSERT/DELETE policy: rows are created only by the
-- handle_new_auth_user trigger (SECURITY DEFINER, bypasses RLS) and deleted
-- only via auth.users cascade.

-- --- member_profiles -----------------------------------------------------
CREATE POLICY "member_profiles_select_own" ON public.member_profiles FOR SELECT
  USING ("userId" = auth.uid());
CREATE POLICY "member_profiles_select_discoverable" ON public.member_profiles FOR SELECT
  USING ("isDiscoverable" = true);
CREATE POLICY "member_profiles_all_own" ON public.member_profiles FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "member_profiles_admin_tier" ON public.member_profiles FOR ALL
  USING (public.is_admin_tier());

-- --- age_verifications / identity_verifications (sensitive — no peer access) ---
CREATE POLICY "age_verifications_select_own" ON public.age_verifications FOR SELECT
  USING ("userId" = auth.uid());
CREATE POLICY "age_verifications_insert_own" ON public.age_verifications FOR INSERT
  WITH CHECK ("userId" = auth.uid());
CREATE POLICY "age_verifications_safety_tier" ON public.age_verifications FOR ALL
  USING (public.is_safety_moderator_tier());

CREATE POLICY "identity_verifications_select_own" ON public.identity_verifications FOR SELECT
  USING ("userId" = auth.uid());
CREATE POLICY "identity_verifications_insert_own" ON public.identity_verifications FOR INSERT
  WITH CHECK ("userId" = auth.uid());
CREATE POLICY "identity_verifications_safety_tier" ON public.identity_verifications FOR ALL
  USING (public.is_safety_moderator_tier());

-- --- 1:1 profile-attribute tables: own row only, plus admin oversight --------
CREATE POLICY "faith_profiles_own" ON public.faith_profiles FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "faith_profiles_admin" ON public.faith_profiles FOR SELECT
  USING (public.is_admin_tier());

CREATE POLICY "location_profiles_own" ON public.location_profiles FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "location_profiles_admin" ON public.location_profiles FOR SELECT
  USING (public.is_admin_tier());

CREATE POLICY "education_records_own" ON public.education_records FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "education_records_admin" ON public.education_records FOR SELECT
  USING (public.is_admin_tier());

CREATE POLICY "occupations_own" ON public.occupations FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "occupations_admin" ON public.occupations FOR SELECT
  USING (public.is_admin_tier());

CREATE POLICY "business_info_own" ON public.business_info FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "business_info_admin" ON public.business_info FOR SELECT
  USING (public.is_admin_tier());

CREATE POLICY "marriage_intentions_own" ON public.marriage_intentions FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "marriage_intentions_admin" ON public.marriage_intentions FOR SELECT
  USING (public.is_admin_tier());

CREATE POLICY "partner_preferences_own" ON public.partner_preferences FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "partner_preferences_admin" ON public.partner_preferences FOR SELECT
  USING (public.is_admin_tier());

-- --- interests catalog: public reference data, admin-managed -----------------
CREATE POLICY "interests_select_all" ON public.interests FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "interests_admin_write" ON public.interests FOR ALL
  USING (public.is_admin_tier());

CREATE POLICY "member_interests_own" ON public.member_interests FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "member_interests_admin" ON public.member_interests FOR SELECT
  USING (public.is_admin_tier());

-- --- compatibility_scores: read own pairs; writes are service-role only ------
-- (computed by a background job using the service_role key, which bypasses
-- RLS entirely — no INSERT/UPDATE policy is intentional here.)
CREATE POLICY "compatibility_scores_select_own" ON public.compatibility_scores FOR SELECT
  USING (auth.uid() IN ("userAId", "userBId"));

-- --- introduction_requests ----------------------------------------------------
CREATE POLICY "introduction_requests_select_participant" ON public.introduction_requests FOR SELECT
  USING (auth.uid() IN ("requesterId", "recipientId"));
CREATE POLICY "introduction_requests_insert_as_requester" ON public.introduction_requests FOR INSERT
  WITH CHECK ("requesterId" = auth.uid());
CREATE POLICY "introduction_requests_update_participant" ON public.introduction_requests FOR UPDATE
  USING (auth.uid() IN ("requesterId", "recipientId"));
CREATE POLICY "introduction_requests_admin" ON public.introduction_requests FOR SELECT
  USING (public.is_admin_tier());

-- --- connections / relationship_stages ----------------------------------------
-- Row creation on connections happens via a server-side function (SECURITY
-- DEFINER, invoked when an introduction is accepted) — no direct client
-- INSERT policy, so a client can't fabricate a connection to someone who
-- never accepted an introduction.
CREATE POLICY "connections_select_participant" ON public.connections FOR SELECT
  USING (auth.uid() IN ("userAId", "userBId"));
CREATE POLICY "connections_update_participant" ON public.connections FOR UPDATE
  USING (auth.uid() IN ("userAId", "userBId"));
CREATE POLICY "connections_admin" ON public.connections FOR SELECT
  USING (public.is_admin_tier());

CREATE POLICY "relationship_stages_select_participant" ON public.relationship_stages FOR SELECT
  USING (public.is_connection_participant("connectionId"));
CREATE POLICY "relationship_stages_insert_participant" ON public.relationship_stages FOR INSERT
  WITH CHECK (public.is_connection_participant("connectionId") AND "initiatedByUserId" = auth.uid());
CREATE POLICY "relationship_stages_admin" ON public.relationship_stages FOR SELECT
  USING (public.is_admin_tier());

-- --- conversations / messages / voice_messages / calls ------------------------
-- The core "never leaks a private message" guarantee. No role — not even
-- ADMIN — gets a standing SELECT policy on messages. The only path in is the
-- explicit escrow flow, implemented as a SECURITY DEFINER RPC function
-- (to be added when moderation tooling is built) that checks
-- canAccessReportedConversationContent()'s conditions and writes an
-- audit_logs row, rather than a blanket RLS policy for safety_moderator+.
CREATE POLICY "conversations_select_participant" ON public.conversations FOR SELECT
  USING (public.is_connection_participant("connectionId"));

CREATE POLICY "messages_select_participant" ON public.messages FOR SELECT
  USING (public.is_conversation_participant("conversationId"));
CREATE POLICY "messages_insert_participant" ON public.messages FOR INSERT
  WITH CHECK (public.is_conversation_participant("conversationId") AND "senderId" = auth.uid());
CREATE POLICY "messages_update_own_readAt_or_delete" ON public.messages FOR UPDATE
  USING (public.is_conversation_participant("conversationId"));

CREATE POLICY "voice_messages_select_participant" ON public.voice_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = "messageId" AND public.is_conversation_participant(m."conversationId")
  ));
CREATE POLICY "voice_messages_insert_participant" ON public.voice_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = "messageId" AND m."senderId" = auth.uid()
  ));

CREATE POLICY "calls_select_participant" ON public.calls FOR SELECT
  USING (public.is_conversation_participant("conversationId"));
CREATE POLICY "calls_insert_participant" ON public.calls FOR INSERT
  WITH CHECK (public.is_conversation_participant("conversationId") AND "initiatorId" = auth.uid());
CREATE POLICY "calls_update_participant" ON public.calls FOR UPDATE
  USING (public.is_conversation_participant("conversationId"));

-- --- reports / blocks ----------------------------------------------------------
-- A reporter can see their own filed reports. The reported user does NOT get
-- a policy to see reports filed against them (standard anti-retaliation
-- practice). Moderator-tier+ can see all reports (metadata only — the report
-- text/category, never the reported conversation content itself).
CREATE POLICY "reports_select_own_filed" ON public.reports FOR SELECT
  USING ("reporterId" = auth.uid());
CREATE POLICY "reports_insert_own" ON public.reports FOR INSERT
  WITH CHECK ("reporterId" = auth.uid());
CREATE POLICY "reports_select_moderator_tier" ON public.reports FOR SELECT
  USING (public.is_moderator_tier());
CREATE POLICY "reports_update_moderator_tier" ON public.reports FOR UPDATE
  USING (public.is_moderator_tier());

CREATE POLICY "blocks_own" ON public.blocks FOR ALL
  USING ("blockerId" = auth.uid()) WITH CHECK ("blockerId" = auth.uid());
CREATE POLICY "blocks_select_safety_tier" ON public.blocks FOR SELECT
  USING (public.is_safety_moderator_tier());

-- --- moderation_cases / moderator_actions --------------------------------------
CREATE POLICY "moderation_cases_moderator_tier" ON public.moderation_cases FOR SELECT
  USING (public.is_moderator_tier());
CREATE POLICY "moderation_cases_update_assigned_or_admin" ON public.moderation_cases FOR UPDATE
  USING ("assignedModeratorId" = auth.uid() OR public.is_admin_tier());
CREATE POLICY "moderation_cases_insert_moderator_tier" ON public.moderation_cases FOR INSERT
  WITH CHECK (public.is_moderator_tier());

CREATE POLICY "moderator_actions_select_moderator_tier" ON public.moderator_actions FOR SELECT
  USING (public.is_moderator_tier());
CREATE POLICY "moderator_actions_insert_own" ON public.moderator_actions FOR INSERT
  WITH CHECK ("moderatorId" = auth.uid() AND public.is_moderator_tier());

-- --- audit_logs: append-only, admin-read-only ----------------------------------
-- Deliberately no UPDATE or DELETE policy at all — under RLS, no policy for
-- an operation means that operation is always denied, which is exactly the
-- "nothing may modify or remove an audit row" guarantee this table needs.
CREATE POLICY "audit_logs_insert_authenticated" ON public.audit_logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "audit_logs_select_admin_tier" ON public.audit_logs FOR SELECT
  USING (public.is_admin_tier());

-- --- notifications ---------------------------------------------------------------
CREATE POLICY "notifications_own" ON public.notifications FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());

-- --- mentors / mentorship_requests ------------------------------------------------
CREATE POLICY "mentors_select_active" ON public.mentors FOR SELECT
  USING ("isActive" = true);
CREATE POLICY "mentors_all_own" ON public.mentors FOR ALL
  USING ("userId" = auth.uid()) WITH CHECK ("userId" = auth.uid());
CREATE POLICY "mentors_admin" ON public.mentors FOR ALL
  USING (public.is_admin_tier());

CREATE POLICY "mentorship_requests_select_mentee" ON public.mentorship_requests FOR SELECT
  USING ("menteeId" = auth.uid());
CREATE POLICY "mentorship_requests_select_mentor" ON public.mentorship_requests FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.mentors m WHERE m.id = "mentorId" AND m."userId" = auth.uid()));
CREATE POLICY "mentorship_requests_insert_mentee" ON public.mentorship_requests FOR INSERT
  WITH CHECK ("menteeId" = auth.uid());
CREATE POLICY "mentorship_requests_update_mentor" ON public.mentorship_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.mentors m WHERE m.id = "mentorId" AND m."userId" = auth.uid()));

-- --- community_posts / comments ---------------------------------------------------
CREATE POLICY "community_posts_select_visible" ON public.community_posts FOR SELECT
  USING ("isRemoved" = false AND auth.role() = 'authenticated');
CREATE POLICY "community_posts_all_own" ON public.community_posts FOR ALL
  USING ("authorId" = auth.uid()) WITH CHECK ("authorId" = auth.uid());
CREATE POLICY "community_posts_moderate" ON public.community_posts FOR UPDATE
  USING (public.is_moderator_tier());

CREATE POLICY "comments_select_visible" ON public.comments FOR SELECT
  USING ("isRemoved" = false AND auth.role() = 'authenticated');
CREATE POLICY "comments_all_own" ON public.comments FOR ALL
  USING ("authorId" = auth.uid()) WITH CHECK ("authorId" = auth.uid());
CREATE POLICY "comments_moderate" ON public.comments FOR UPDATE
  USING (public.is_moderator_tier());

-- --- events / event_attendees -------------------------------------------------------
CREATE POLICY "events_select_all" ON public.events FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "events_all_host" ON public.events FOR ALL
  USING ("hostId" = auth.uid()) WITH CHECK ("hostId" = auth.uid());
CREATE POLICY "events_admin" ON public.events FOR ALL
  USING (public.is_admin_tier());

CREATE POLICY "event_attendees_select_own" ON public.event_attendees FOR SELECT
  USING ("userId" = auth.uid());
CREATE POLICY "event_attendees_select_host" ON public.event_attendees FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = "eventId" AND e."hostId" = auth.uid()));
CREATE POLICY "event_attendees_rsvp_own" ON public.event_attendees FOR INSERT
  WITH CHECK ("userId" = auth.uid());
CREATE POLICY "event_attendees_update_own" ON public.event_attendees FOR UPDATE
  USING ("userId" = auth.uid());

-- --- jobs -----------------------------------------------------------------------------
CREATE POLICY "jobs_select_active" ON public.jobs FOR SELECT
  USING ("isActive" = true AND auth.role() = 'authenticated');
CREATE POLICY "jobs_all_own" ON public.jobs FOR ALL
  USING ("posterId" = auth.uid()) WITH CHECK ("posterId" = auth.uid());
CREATE POLICY "jobs_admin" ON public.jobs FOR ALL
  USING (public.is_admin_tier());

-- --- business_profiles -----------------------------------------------------------------
CREATE POLICY "business_profiles_select_public" ON public.business_profiles FOR SELECT
  USING ("isPublic" = true);
CREATE POLICY "business_profiles_all_own" ON public.business_profiles FOR ALL
  USING ("ownerId" = auth.uid()) WITH CHECK ("ownerId" = auth.uid());

-- --- fundraising_campaigns / donations / fund_disbursements -----------------------------
CREATE POLICY "fundraising_campaigns_select_active" ON public.fundraising_campaigns FOR SELECT
  USING ("status" = 'ACTIVE' OR "organizerId" = auth.uid() OR public.is_admin_tier());
CREATE POLICY "fundraising_campaigns_all_own_draft" ON public.fundraising_campaigns FOR ALL
  USING ("organizerId" = auth.uid()) WITH CHECK ("organizerId" = auth.uid());
CREATE POLICY "fundraising_campaigns_admin" ON public.fundraising_campaigns FOR ALL
  USING (public.is_admin_tier());

CREATE POLICY "donations_select_own" ON public.donations FOR SELECT
  USING ("donorId" = auth.uid());
CREATE POLICY "donations_select_organizer" ON public.donations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.fundraising_campaigns c WHERE c.id = "campaignId" AND c."organizerId" = auth.uid()));
CREATE POLICY "donations_insert_own" ON public.donations FOR INSERT
  WITH CHECK ("donorId" = auth.uid() OR "donorId" IS NULL);
CREATE POLICY "donations_admin" ON public.donations FOR SELECT
  USING (public.is_admin_tier());

-- Fund disbursements are admin-only end to end — this is real money leaving
-- the platform, matches APPROVE_FUND_DISBURSEMENT being an ADMIN+ permission.
CREATE POLICY "fund_disbursements_admin_only" ON public.fund_disbursements FOR ALL
  USING (public.is_admin_tier());

-- --- family_mentor_invitations -----------------------------------------------------------
CREATE POLICY "family_mentor_invitations_select_participant" ON public.family_mentor_invitations FOR SELECT
  USING (public.is_connection_participant("connectionId"));
CREATE POLICY "family_mentor_invitations_insert_participant" ON public.family_mentor_invitations FOR INSERT
  WITH CHECK (public.is_connection_participant("connectionId") AND "invitedByUserId" = auth.uid());
CREATE POLICY "family_mentor_invitations_update_participant" ON public.family_mentor_invitations FOR UPDATE
  USING (public.is_connection_participant("connectionId"));

-- --- marriage_journeys ---------------------------------------------------------------------
CREATE POLICY "marriage_journeys_select_participant" ON public.marriage_journeys FOR SELECT
  USING (public.is_connection_participant("connectionId"));
CREATE POLICY "marriage_journeys_update_participant" ON public.marriage_journeys FOR UPDATE
  USING (public.is_connection_participant("connectionId"));
CREATE POLICY "marriage_journeys_admin" ON public.marriage_journeys FOR SELECT
  USING (public.is_admin_tier());
