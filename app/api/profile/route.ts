import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth/session";
import {
  profileEssaysSchema,
  educationSchema,
  occupationSchema,
  businessInfoSchema,
  firstErrorMessage,
} from "@/lib/validation/profile";
import { calculateProfileCompletion } from "@/lib/domain/profile-completion";
import { deriveVerificationBadges } from "@/lib/domain/verification-badges";
import { calculateAge } from "@/lib/domain/eligibility";

export async function GET() {
  const auth = await requireActiveUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
  }

  const supabase = createClient();
  const userId = auth.user.id;

  const [
    { data: profile },
    { data: location },
    { data: faith },
    { data: education },
    { data: occupation },
    { data: business },
    { data: memberInterests },
    { data: marriageIntention },
    { data: partnerPreference },
    { data: phoneRow },
    { data: identityRow },
  ] = await Promise.all([
    supabase.from("member_profiles").select("*").eq("userId", userId).maybeSingle(),
    supabase.from("location_profiles").select("*").eq("userId", userId).maybeSingle(),
    supabase.from("faith_profiles").select("*").eq("userId", userId).maybeSingle(),
    supabase.from("education_records").select("*").eq("userId", userId).maybeSingle(),
    supabase.from("occupations").select("*").eq("userId", userId).maybeSingle(),
    supabase.from("business_info").select("*").eq("userId", userId).maybeSingle(),
    supabase.from("member_interests").select("interests(name)").eq("userId", userId),
    supabase.from("marriage_intentions").select("*").eq("userId", userId).maybeSingle(),
    supabase.from("partner_preferences").select("*").eq("userId", userId).maybeSingle(),
    supabase.from("phone_verifications").select("status").eq("userId", userId).maybeSingle(),
    supabase.from("identity_verifications").select("status").eq("userId", userId).maybeSingle(),
  ]);

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  const interestNames = (memberInterests ?? [])
    .map((row: { interests: { name: string } | { name: string }[] | null }) => {
      const rel = row.interests;
      if (!rel) return null;
      return Array.isArray(rel) ? rel[0]?.name ?? null : rel.name;
    })
    .filter((n: string | null): n is string => Boolean(n));

  const verification = deriveVerificationBadges({
    emailVerified: Boolean(authUser?.email_confirmed_at),
    phoneVerified: phoneRow?.status === "VERIFIED",
    identityVerified: identityRow?.status === "VERIFIED",
    communityVerified: Boolean(profile?.communityVerified),
  });

  const completion = calculateProfileCompletion({
    hasPhoto: Boolean(profile?.headlinePhotoKey),
    bio: profile?.bio ?? null,
    hasLocation: Boolean(location),
    hasFaithProfile: Boolean(faith),
    hasEducation: Boolean(education),
    hasOccupation: Boolean(occupation),
    interestCount: interestNames.length,
    skills: profile?.skills ?? [],
    familyValues: profile?.familyValues ?? null,
    hasMarriageIntention: Boolean(marriageIntention),
    hasPartnerPreference: Boolean(partnerPreference),
    lifeGoals: profile?.lifeGoals ?? null,
    financialGoals: profile?.financialGoals ?? null,
    healthyMarriageBeliefs: profile?.healthyMarriageBeliefs ?? null,
    lookingForInSpouse: profile?.lookingForInSpouse ?? null,
  });

  return NextResponse.json({
    ok: true,
    profile: profile
      ? { ...profile, age: calculateAge(new Date(profile.dateOfBirth)) }
      : null,
    location,
    faith,
    education,
    occupation,
    business,
    interests: interestNames,
    marriageIntention,
    partnerPreference,
    verification,
    completion,
  });
}

const SECTION_HANDLERS: Record<
  string,
  { schema: typeof profileEssaysSchema | typeof educationSchema | typeof occupationSchema | typeof businessInfoSchema; table: string }
> = {
  essays: { schema: profileEssaysSchema, table: "member_profiles" },
  education: { schema: educationSchema, table: "education_records" },
  occupation: { schema: occupationSchema, table: "occupations" },
  business: { schema: businessInfoSchema, table: "business_info" },
};

export async function PATCH(request: Request) {
  const auth = await requireActiveUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { section, data } = (body ?? {}) as { section?: string; data?: unknown };
  const handler = section ? SECTION_HANDLERS[section] : undefined;
  if (!handler) {
    return NextResponse.json(
      { ok: false, error: "Unknown profile section." },
      { status: 400 }
    );
  }

  const parsed = handler.schema.safeParse(data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: firstErrorMessage(parsed.error) },
      { status: 422 }
    );
  }

  const supabase = createClient();

  if (section === "essays") {
    const { error } = await supabase
      .from("member_profiles")
      .update(parsed.data)
      .eq("userId", auth.user.id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from(handler.table)
      .upsert({ userId: auth.user.id, ...parsed.data }, { onConflict: "userId" });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
