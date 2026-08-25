-- =============================================================================
-- 0001_init
-- Hand-authored to mirror prisma/schema.prisma exactly (see ARCHITECTURE.md for
-- why this exists instead of a `prisma migrate dev` output, and
-- scripts/validate_schema_consistency.py for the automated table/column check
-- that keeps the two files honest).
--
-- This migration has NOT been executed against a live PostgreSQL instance in
-- this environment (see PHASE1_REPORT.md, "Testing performed / not performed").
-- Run it against a real database before relying on it.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- ENUM TYPES
-- -----------------------------------------------------------------------------

CREATE TYPE "Role" AS ENUM ('MEMBER','MENTOR','MODERATOR','SAFETY_MODERATOR','ADMIN','SUPER_ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE','SUSPENDED','BANNED','DEACTIVATED_BY_USER','PENDING_DELETION');
CREATE TYPE "Gender" AS ENUM ('MALE','FEMALE');
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED','PENDING','VERIFIED','REJECTED');
CREATE TYPE "IdentityVerificationMethod" AS ENUM ('GOVERNMENT_ID','VIDEO_VERIFICATION','THIRD_PARTY_KYC');
CREATE TYPE "FaithImportance" AS ENUM ('CENTRAL','VERY_IMPORTANT','IMPORTANT','EXPLORING');
CREATE TYPE "EducationLevel" AS ENUM ('HIGH_SCHOOL','SOME_COLLEGE','ASSOCIATE','BACHELORS','MASTERS','DOCTORATE','TRADE_VOCATIONAL','OTHER');
CREATE TYPE "MarriageTimeframe" AS ENUM ('WITHIN_A_YEAR','ONE_TO_TWO_YEARS','TWO_PLUS_YEARS','WHEN_RIGHT_PERSON_FOUND');
CREATE TYPE "IntroductionStatus" AS ENUM ('PENDING','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN');
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE','PAUSED','ENDED');
CREATE TYPE "RelationshipStageType" AS ENUM ('DISCOVERY','INTRODUCED','FRIENDSHIP','DISCERNMENT','COURTSHIP','FAMILY_MENTOR_INVOLVEMENT','MARRIAGE_PREPARATION','MARRIED','ENDED');
CREATE TYPE "MessageType" AS ENUM ('TEXT','VOICE','SYSTEM');
CREATE TYPE "CallType" AS ENUM ('AUDIO','VIDEO');
CREATE TYPE "CallStatus" AS ENUM ('INITIATED','RINGING','ACCEPTED','DECLINED','MISSED','ENDED','FAILED');
CREATE TYPE "ReportReasonCategory" AS ENUM ('HARASSMENT','INAPPROPRIATE_CONTENT','SEXUAL_SOLICITATION','SCAM_OR_FINANCIAL','FAKE_PROFILE','UNDERAGE_CONCERN','SAFETY_CONCERN','OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED');
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN','INVESTIGATING','ACTION_TAKEN','ESCALATED','CLOSED');
CREATE TYPE "ModerationPriority" AS ENUM ('LOW','NORMAL','HIGH','CRITICAL');
CREATE TYPE "ModeratorActionType" AS ENUM ('WARNING_ISSUED','CONTENT_REMOVED','ACCOUNT_SUSPENDED','ACCOUNT_BANNED','ACCOUNT_REINSTATED','CASE_ESCALATED','CASE_CLOSED','NO_ACTION_TAKEN');
CREATE TYPE "NotificationType" AS ENUM ('NEW_INTRODUCTION','INTRODUCTION_ACCEPTED','INTRODUCTION_DECLINED','NEW_MESSAGE','NEW_CALL','STAGE_CHANGE','MENTORSHIP_REQUEST','MODERATION_UPDATE','VERIFICATION_UPDATE','EVENT_REMINDER','DONATION_RECEIPT','SYSTEM_ANNOUNCEMENT');
CREATE TYPE "MentorshipRequestStatus" AS ENUM ('PENDING','ACCEPTED','DECLINED','COMPLETED','WITHDRAWN');
CREATE TYPE "PostVisibility" AS ENUM ('PUBLIC','MEMBERS_ONLY','MENTORS_ONLY');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','ACTIVE','COMPLETED','CANCELLED');
CREATE TYPE "DonationStatus" AS ENUM ('PENDING','COMPLETED','FAILED','REFUNDED');
CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING','APPROVED','PAID','REJECTED');
CREATE TYPE "FamilyMentorInviteStatus" AS ENUM ('PENDING','ACCEPTED','DECLINED','REVOKED');
CREATE TYPE "FamilyMentorAccessScope" AS ENUM ('VIEW_STAGE_ONLY','VIEW_STAGE_AND_SUMMARY');

-- -----------------------------------------------------------------------------
-- 1-2. USERS  (auth identity itself is Supabase Auth's job, not ours)
-- -----------------------------------------------------------------------------
-- DECISION (made when connecting this schema to a real Supabase project —
-- see ARCHITECTURE.md "Supabase Auth integration"): Phase 1's original design
-- had a hand-rolled `auth_identities` table with an argon2id passwordHash
-- column. Now that this is actually running on Supabase, that table is
-- removed in favor of Supabase's own `auth.users` (which already does
-- credential storage, password hashing, email/phone OTP verification, and
-- OAuth identity linking correctly and is security-reviewed by Supabase).
-- `public.users.id` is a 1:1 extension of `auth.users.id`, created
-- automatically by the trigger below whenever someone signs up.
-- -----------------------------------------------------------------------------

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  "role" "Role" NOT NULL DEFAULT 'MEMBER',
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ
);

-- Auto-provision a public.users row whenever Supabase Auth creates an
-- auth.users row (email/password signup, OAuth, phone signup — all of them
-- funnel through this one trigger). Runs as SECURITY DEFINER so it can write
-- to public.users even though the calling client only has anon/authenticated
-- grants.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, role, status)
  VALUES (NEW.id, 'MEMBER', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 3-4. MEMBER PROFILES / GENDER
-- -----------------------------------------------------------------------------

CREATE TABLE "member_profiles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "displayName" TEXT NOT NULL,
  "gender" "Gender" NOT NULL,
  "dateOfBirth" DATE NOT NULL,
  "bio" TEXT,
  "photoKeys" TEXT[] NOT NULL DEFAULT '{}',
  "headlinePhotoKey" TEXT,
  "isDiscoverable" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_member_profiles_gender" ON "member_profiles"("gender");
CREATE INDEX "idx_member_profiles_isDiscoverable" ON "member_profiles"("isDiscoverable");

-- -----------------------------------------------------------------------------
-- 5. AGE VERIFICATION
-- -----------------------------------------------------------------------------

CREATE TABLE "age_verifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "method" "IdentityVerificationMethod",
  "minimumAgeAtVerification" INTEGER NOT NULL DEFAULT 18,
  "verifiedAt" TIMESTAMPTZ,
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 6-7. PHONE / EMAIL VERIFICATION
-- -----------------------------------------------------------------------------
-- No table here by design. `auth.users.email` / `.phone` and
-- `.email_confirmed_at` / `.phone_confirmed_at` (managed by Supabase Auth)
-- are the source of truth. Application code reads verification status via
-- `auth.users`, not a duplicate table here — see ARCHITECTURE.md.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 8. IDENTITY VERIFICATION
-- -----------------------------------------------------------------------------

CREATE TABLE "identity_verifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "method" "IdentityVerificationMethod",
  "documentStorageKey" TEXT,
  "providerReference" TEXT,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ,
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_identity_verifications_status" ON "identity_verifications"("status");

-- -----------------------------------------------------------------------------
-- 9. FAITH PROFILES
-- -----------------------------------------------------------------------------

CREATE TABLE "faith_profiles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "denomination" TEXT,
  "faithCommunity" TEXT,
  "faithImportance" "FaithImportance" NOT NULL,
  "testimony" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 10. LOCATION PROFILES
-- -----------------------------------------------------------------------------

CREATE TABLE "location_profiles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "country" TEXT NOT NULL,
  "region" TEXT,
  "city" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "willingToRelocate" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_location_profiles_country_region" ON "location_profiles"("country","region");

-- -----------------------------------------------------------------------------
-- 11. EDUCATION
-- -----------------------------------------------------------------------------

CREATE TABLE "education_records" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "level" "EducationLevel" NOT NULL,
  "fieldOfStudy" TEXT,
  "institution" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 12. OCCUPATION
-- -----------------------------------------------------------------------------

CREATE TABLE "occupations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "jobTitle" TEXT,
  "employer" TEXT,
  "industry" TEXT,
  "isSelfEmployed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 13. BUSINESS INFO (profile attribute)
-- -----------------------------------------------------------------------------

CREATE TABLE "business_info" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "ownsBusiness" BOOLEAN NOT NULL DEFAULT false,
  "businessName" TEXT,
  "businessRole" TEXT,
  "yearsOperating" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 14. INTERESTS
-- -----------------------------------------------------------------------------

CREATE TABLE "interests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL UNIQUE,
  "category" TEXT
);

CREATE TABLE "member_interests" (
  "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "interestId" UUID NOT NULL REFERENCES "interests"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId","interestId")
);

-- -----------------------------------------------------------------------------
-- 15. MARRIAGE INTENTIONS
-- -----------------------------------------------------------------------------

CREATE TABLE "marriage_intentions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "seriouslySeekingMarriage" BOOLEAN NOT NULL DEFAULT true,
  "timeframe" "MarriageTimeframe" NOT NULL,
  "wantsChildren" BOOLEAN,
  "numberOfChildrenDesired" INTEGER,
  "hasChildrenAlready" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 16. PARTNER PREFERENCES
-- -----------------------------------------------------------------------------

CREATE TABLE "partner_preferences" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "preferredGender" "Gender" NOT NULL,
  "minAge" INTEGER NOT NULL,
  "maxAge" INTEGER NOT NULL,
  "maxDistanceKm" INTEGER,
  "requireSameFaith" BOOLEAN NOT NULL DEFAULT false,
  "minFaithImportance" "FaithImportance",
  "minEducationLevel" "EducationLevel",
  "openToChildrenAlready" BOOLEAN NOT NULL DEFAULT true,
  "openToRelocation" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 17. COMPATIBILITY SCORES
-- -----------------------------------------------------------------------------

CREATE TABLE "compatibility_scores" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userAId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "userBId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "score" DOUBLE PRECISION NOT NULL,
  "factorBreakdown" JSONB NOT NULL,
  "computedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("userAId","userBId")
);
CREATE INDEX "idx_compatibility_scores_userBId" ON "compatibility_scores"("userBId");

-- -----------------------------------------------------------------------------
-- 18. INTRODUCTION REQUESTS
-- -----------------------------------------------------------------------------

CREATE TABLE "introduction_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "requesterId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "recipientId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "IntroductionStatus" NOT NULL DEFAULT 'PENDING',
  "introMessage" TEXT,
  "respondedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("requesterId","recipientId","createdAt")
);
CREATE INDEX "idx_introduction_requests_recipient_status" ON "introduction_requests"("recipientId","status");

-- -----------------------------------------------------------------------------
-- 19-20. CONNECTIONS / RELATIONSHIP STAGES
-- -----------------------------------------------------------------------------

CREATE TABLE "connections" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userAId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "userBId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "originIntroductionId" UUID UNIQUE REFERENCES "introduction_requests"("id"),
  "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentStage" "RelationshipStageType" NOT NULL DEFAULT 'INTRODUCED',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("userAId","userBId")
);
CREATE INDEX "idx_connections_userBId" ON "connections"("userBId");

CREATE TABLE "relationship_stages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "connectionId" UUID NOT NULL REFERENCES "connections"("id") ON DELETE CASCADE,
  "stage" "RelationshipStageType" NOT NULL,
  "initiatedByUserId" UUID REFERENCES "users"("id"),
  "notes" TEXT,
  "enteredAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "endedAt" TIMESTAMPTZ
);
CREATE INDEX "idx_relationship_stages_connectionId" ON "relationship_stages"("connectionId");

-- -----------------------------------------------------------------------------
-- 21-22. CONVERSATIONS / MESSAGES
-- -----------------------------------------------------------------------------

CREATE TABLE "conversations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "connectionId" UUID NOT NULL UNIQUE REFERENCES "connections"("id") ON DELETE CASCADE,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversationId" UUID NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "senderId" UUID NOT NULL REFERENCES "users"("id"),
  "type" "MessageType" NOT NULL DEFAULT 'TEXT',
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "readAt" TIMESTAMPTZ,
  "deletedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_messages_conversationId_createdAt" ON "messages"("conversationId","createdAt");
CREATE INDEX "idx_messages_senderId" ON "messages"("senderId");

-- -----------------------------------------------------------------------------
-- 23. VOICE MESSAGES
-- -----------------------------------------------------------------------------

CREATE TABLE "voice_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL UNIQUE REFERENCES "messages"("id") ON DELETE CASCADE,
  "audioStorageKey" TEXT NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "transcript" TEXT
);

-- -----------------------------------------------------------------------------
-- 24. CALLS
-- -----------------------------------------------------------------------------

CREATE TABLE "calls" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversationId" UUID NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "initiatorId" UUID NOT NULL REFERENCES "users"("id"),
  "type" "CallType" NOT NULL,
  "status" "CallStatus" NOT NULL DEFAULT 'INITIATED',
  "providerSessionId" TEXT,
  "startedAt" TIMESTAMPTZ,
  "endedAt" TIMESTAMPTZ,
  "durationSeconds" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_calls_conversationId" ON "calls"("conversationId");

-- -----------------------------------------------------------------------------
-- 25-26. REPORTS / BLOCKS
-- -----------------------------------------------------------------------------

CREATE TABLE "reports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reporterId" UUID NOT NULL REFERENCES "users"("id"),
  "reportedUserId" UUID NOT NULL REFERENCES "users"("id"),
  "category" "ReportReasonCategory" NOT NULL,
  "description" TEXT NOT NULL,
  "relatedContentType" TEXT,
  "relatedContentId" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_reports_reportedUserId_status" ON "reports"("reportedUserId","status");
CREATE INDEX "idx_reports_reporterId" ON "reports"("reporterId");

CREATE TABLE "blocks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "blockerId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "blockedId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("blockerId","blockedId")
);
CREATE INDEX "idx_blocks_blockedId" ON "blocks"("blockedId");

-- -----------------------------------------------------------------------------
-- 27-28. MODERATION CASES / MODERATOR ACTIONS
-- -----------------------------------------------------------------------------

CREATE TABLE "moderation_cases" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reportId" UUID NOT NULL UNIQUE REFERENCES "reports"("id") ON DELETE CASCADE,
  "assignedModeratorId" UUID REFERENCES "users"("id"),
  "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "ModerationPriority" NOT NULL DEFAULT 'NORMAL',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "closedAt" TIMESTAMPTZ
);
CREATE INDEX "idx_moderation_cases_status_priority" ON "moderation_cases"("status","priority");
CREATE INDEX "idx_moderation_cases_assignedModeratorId" ON "moderation_cases"("assignedModeratorId");

CREATE TABLE "moderator_actions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL REFERENCES "moderation_cases"("id") ON DELETE CASCADE,
  "moderatorId" UUID NOT NULL REFERENCES "users"("id"),
  "actionType" "ModeratorActionType" NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_moderator_actions_caseId" ON "moderator_actions"("caseId");

-- -----------------------------------------------------------------------------
-- 29. AUDIT LOGS (append-only — no UPDATE/DELETE grants for app role; see SECURITY.md)
-- -----------------------------------------------------------------------------

CREATE TABLE "audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorUserId" UUID REFERENCES "users"("id"),
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_audit_logs_actorUserId" ON "audit_logs"("actorUserId");
CREATE INDEX "idx_audit_logs_targetType_targetId" ON "audit_logs"("targetType","targetId");
CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("action");

-- -----------------------------------------------------------------------------
-- 30. NOTIFICATIONS
-- -----------------------------------------------------------------------------

CREATE TABLE "notifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "NotificationType" NOT NULL,
  "payload" JSONB,
  "readAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_notifications_userId_readAt" ON "notifications"("userId","readAt");

-- -----------------------------------------------------------------------------
-- 31-32. MENTORS / MENTORSHIP REQUESTS
-- -----------------------------------------------------------------------------

CREATE TABLE "mentors" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "bio" TEXT,
  "specialties" TEXT[] NOT NULL DEFAULT '{}',
  "capacity" INTEGER NOT NULL DEFAULT 5,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "approvedByUserId" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "mentorship_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "menteeId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "mentorId" UUID NOT NULL REFERENCES "mentors"("id") ON DELETE CASCADE,
  "status" "MentorshipRequestStatus" NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_mentorship_requests_mentorId_status" ON "mentorship_requests"("mentorId","status");
CREATE INDEX "idx_mentorship_requests_menteeId" ON "mentorship_requests"("menteeId");

-- -----------------------------------------------------------------------------
-- 33-34. COMMUNITY POSTS / COMMENTS
-- -----------------------------------------------------------------------------

CREATE TABLE "community_posts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "authorId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "category" TEXT,
  "visibility" "PostVisibility" NOT NULL DEFAULT 'MEMBERS_ONLY',
  "isRemoved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_community_posts_authorId" ON "community_posts"("authorId");
CREATE INDEX "idx_community_posts_visibility_createdAt" ON "community_posts"("visibility","createdAt");

CREATE TABLE "comments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "postId" UUID NOT NULL REFERENCES "community_posts"("id") ON DELETE CASCADE,
  "authorId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "parentCommentId" UUID REFERENCES "comments"("id"),
  "body" TEXT NOT NULL,
  "isRemoved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_comments_postId" ON "comments"("postId");

-- -----------------------------------------------------------------------------
-- 35. EVENTS / EVENT ATTENDEES
-- -----------------------------------------------------------------------------

CREATE TABLE "events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "hostId" UUID NOT NULL REFERENCES "users"("id"),
  "title" TEXT NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "isVirtual" BOOLEAN NOT NULL DEFAULT false,
  "startAt" TIMESTAMPTZ NOT NULL,
  "endAt" TIMESTAMPTZ NOT NULL,
  "capacity" INTEGER,
  "isCancelled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_events_startAt" ON "events"("startAt");

CREATE TABLE "event_attendees" (
  "eventId" UUID NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rsvpAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "attended" BOOLEAN,
  PRIMARY KEY ("eventId","userId")
);

-- -----------------------------------------------------------------------------
-- 36. JOBS
-- -----------------------------------------------------------------------------

CREATE TABLE "jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "posterId" UUID NOT NULL REFERENCES "users"("id"),
  "title" TEXT NOT NULL,
  "company" TEXT,
  "description" TEXT NOT NULL,
  "location" TEXT,
  "isRemote" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_jobs_isActive_createdAt" ON "jobs"("isActive","createdAt");

-- -----------------------------------------------------------------------------
-- 37. BUSINESS PROFILES
-- -----------------------------------------------------------------------------

CREATE TABLE "business_profiles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "businessName" TEXT NOT NULL,
  "category" TEXT,
  "description" TEXT,
  "website" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 38-40. FUNDRAISING CAMPAIGNS / DONATIONS / FUND DISBURSEMENTS
-- -----------------------------------------------------------------------------

CREATE TABLE "fundraising_campaigns" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizerId" UUID NOT NULL REFERENCES "users"("id"),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "goalAmountCents" INTEGER NOT NULL,
  "raisedAmountCents" INTEGER NOT NULL DEFAULT 0,
  "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedByUserId" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_fundraising_campaigns_status" ON "fundraising_campaigns"("status");

CREATE TABLE "donations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" UUID NOT NULL REFERENCES "fundraising_campaigns"("id"),
  "donorId" UUID REFERENCES "users"("id"),
  "amountCents" INTEGER NOT NULL,
  "status" "DonationStatus" NOT NULL DEFAULT 'PENDING',
  "paymentProviderRef" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_donations_campaignId_status" ON "donations"("campaignId","status");
CREATE INDEX "idx_donations_donorId" ON "donations"("donorId");

CREATE TABLE "fund_disbursements" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" UUID NOT NULL REFERENCES "fundraising_campaigns"("id"),
  "amountCents" INTEGER NOT NULL,
  "recipientDescription" TEXT NOT NULL,
  "status" "DisbursementStatus" NOT NULL DEFAULT 'PENDING',
  "approvedByUserId" UUID REFERENCES "users"("id"),
  "disbursedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_fund_disbursements_campaignId_status" ON "fund_disbursements"("campaignId","status");

-- -----------------------------------------------------------------------------
-- 41. FAMILY / MENTOR INVITATIONS
-- -----------------------------------------------------------------------------

CREATE TABLE "family_mentor_invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "connectionId" UUID NOT NULL REFERENCES "connections"("id") ON DELETE CASCADE,
  "invitedByUserId" UUID NOT NULL REFERENCES "users"("id"),
  "inviteeName" TEXT NOT NULL,
  "inviteeEmail" TEXT,
  "inviteeRelationship" TEXT NOT NULL,
  "accessScope" "FamilyMentorAccessScope" NOT NULL DEFAULT 'VIEW_STAGE_ONLY',
  "status" "FamilyMentorInviteStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "idx_family_mentor_invitations_connectionId" ON "family_mentor_invitations"("connectionId");

-- -----------------------------------------------------------------------------
-- 42. MARRIAGE JOURNEYS
-- -----------------------------------------------------------------------------

CREATE TABLE "marriage_journeys" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "connectionId" UUID NOT NULL UNIQUE REFERENCES "connections"("id") ON DELETE CASCADE,
  "preparationStartedAt" TIMESTAMPTZ,
  "milestones" JSONB,
  "marriedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
