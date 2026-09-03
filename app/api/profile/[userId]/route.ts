import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth/session";
import { deriveVerificationBadges, VERIFICATION_DISCLAIMER } from "@/lib/domain/verification-badges";
import { calculateAge } from "@/lib/domain/eligibility";

// DECISION: row-level access is entirely delegated to RLS — this route
// never bypasses it (uses the requester's own session client, not the
// admin client). If the target profile isn't discoverable and the
// requester isn't its owner or an admin, the SELECT below simply returns
// nothing, which is the correct behavior with zero extra code here. This
// route's actual job is FIELD-level redaction once row access is already
// granted — see migration 0007 for why that's an application-layer
// concern rather than something RLS itself expresses.
export async function GET(_request: Request, { params }: { params: { userId: string } }) {
  const auth = await requireActiveUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
  }

  const targetUserId = params.userId;
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("member_profiles")
    .select(
      "userId, displayName, gender, dateOfBirth, maritalStatus, bio, headlinePhotoKey, photoKeys, skills, familyValues, lifeGoals, financialGoals, healthyMarriageBeliefs, lookingForInSpouse, showExactLocation, showOccupationDetails, showBusinessDetails, communityVerified, isDiscoverable"
    )
    .eq("userId", targetUserId)
    .maybeSingle();

  if (!profile) {
    // Either it doesn't exist, or RLS correctly hid it — same response
    // either way, so a non-owner can't distinguish "private profile" from
    // "no such user."
    return NextResponse.json({ ok: false, error: "Profile not found." }, { status: 404 });
  }

  const isOwnProfile = targetUserId === auth.user.id;

  const [
    { data: location },
    { data: faith },
    { data: education },
    { data: occupation },
    { data: business },
    { data: memberInterests },
    { data: phoneRow },
    { data: identityRow },
  ] = await Promise.all([
    supabase.from("location_profiles").select("country, region, city").eq("userId", targetUserId).maybeSingle(),
    supabase.from("faith_profiles").select("denomination, faithCommunity, faithImportance, testimony").eq("userId", targetUserId).maybeSingle(),
    supabase.from("education_records").select("level, fieldOfStudy, institution").eq("userId", targetUserId).maybeSingle(),
    supabase.from("occupations").select("jobTitle, employer, industry, isSelfEmployed").eq("userId", targetUserId).maybeSingle(),
    supabase.from("business_info").select("ownsBusiness, businessName, businessRole, yearsOperating").eq("userId", targetUserId).maybeSingle(),
    supabase.from("member_interests").select("interests(name)").eq("userId", targetUserId),
    supabase.from("phone_verifications").select("status").eq("userId", targetUserId).maybeSingle(),
    supabase.from("identity_verifications").select("status").eq("userId", targetUserId).maybeSingle(),
  ]);

  // Email confirmation can only be read from auth.users for the CALLER's own
  // session (supabase.auth.getUser() is always "who am I", never "look up
  // someone else") — so for another member's profile we treat email as
  // verified whenever their account reached ACTIVE at all, since that
  // transition itself requires email confirmation (see migration 0005's
  // trigger). For the viewer's own profile we still ask directly, for
  // accuracy over inference.
  let emailVerified = true; // implied by ACTIVE status for any other member
  if (isOwnProfile) {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    emailVerified = Boolean(authUser?.email_confirmed_at);
  }

  const interestNames = (memberInterests ?? [])
    .map((row: { interests: { name: string } | { name: string }[] | null }) => {
      const rel = row.interests;
      if (!rel) return null;
      return Array.isArray(rel) ? rel[0]?.name ?? null : rel.name;
    })
    .filter((n: string | null): n is string => Boolean(n));

  const verification = deriveVerificationBadges({
    emailVerified,
    phoneVerified: phoneRow?.status === "VERIFIED",
    identityVerified: identityRow?.status === "VERIFIED",
    communityVerified: profile.communityVerified,
  });

  // Field-level redaction per the profile owner's own privacy toggles.
  // Owners viewing their own profile always see everything unredacted —
  // these toggles govern what OTHERS see, not a mystery to the owner
  // themselves.
  const redactedLocation = location
    ? isOwnProfile || profile.showExactLocation
      ? location
      : { country: location.country, region: null, city: null }
    : null;

  const redactedOccupation =
    occupation && (isOwnProfile || profile.showOccupationDetails) ? occupation : null;

  const redactedBusiness =
    business && (isOwnProfile || profile.showBusinessDetails) ? business : null;

  let photoUrl: string | null = null;
  if (profile.headlinePhotoKey) {
    const { data: signed } = await supabase.storage
      .from("profile-photos")
      .createSignedUrl(profile.headlinePhotoKey, 300);
    photoUrl = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    ok: true,
    profile: {
      userId: profile.userId,
      displayName: profile.displayName,
      age: calculateAge(new Date(profile.dateOfBirth)),
      gender: profile.gender,
      maritalStatus: profile.maritalStatus,
      bio: profile.bio,
      photoUrl,
      skills: profile.skills,
      familyValues: profile.familyValues,
      lifeGoals: profile.lifeGoals,
      financialGoals: profile.financialGoals,
      healthyMarriageBeliefs: profile.healthyMarriageBeliefs,
      lookingForInSpouse: profile.lookingForInSpouse,
      // Deliberately NOT included, ever, in this public-facing response:
      // phone number, email address, raw storage keys, raw verification
      // documents/provider references, who granted community
      // verification, or anything from private conversations/moderation
      // records. None of those are even queried above.
    },
    location: redactedLocation,
    faith,
    education, // education level itself isn't gated by a toggle — only occupation/business are, per the privacy schema
    occupation: redactedOccupation,
    business: redactedBusiness,
    interests: interestNames,
    verification,
    verificationDisclaimer: VERIFICATION_DISCLAIMER,
    isOwnProfile,
  });
}
