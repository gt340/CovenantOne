import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getAdminClient, ageFromDob } from "@/lib/discovery";
import { scoreCompatibility, CompatibilityCandidate, Gender } from "@/lib/compatibility";

async function getAuthedUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

async function loadBundle(admin: ReturnType<typeof getAdminClient>, userId: string) {
  const [{ data: profile }, { data: loc }, { data: faith }, { data: edu }, { data: occ }, { data: biz }, { data: mi }, { data: interestRows }] =
    await Promise.all([
      admin
        .from("member_profiles")
        .select(
          "userId, displayName, gender, dateOfBirth, headlinePhotoKey, isDiscoverable, lifeGoals, familyValues, showExactLocation, showOccupationDetails, showBusinessDetails"
        )
        .eq("userId", userId)
        .single(),
      admin.from("location_profiles").select("country, region, city, willingToRelocate").eq("userId", userId).maybeSingle(),
      admin.from("faith_profiles").select("faithImportance, denomination").eq("userId", userId).maybeSingle(),
      admin.from("education_records").select("level, fieldOfStudy").eq("userId", userId).maybeSingle(),
      admin.from("occupations").select("jobTitle, employer, industry").eq("userId", userId).maybeSingle(),
      admin.from("business_info").select("ownsBusiness, businessName").eq("userId", userId).maybeSingle(),
      admin
        .from("marriage_intentions")
        .select("seriouslySeekingMarriage, timeframe, wantsChildren, hasChildrenAlready")
        .eq("userId", userId)
        .maybeSingle(),
      admin.from("member_interests").select("interestId, interests(name)").eq("userId", userId),
    ]);

  return { profile, loc, faith, edu, occ, biz, mi, interestRows };
}

function toCandidate(bundle: Awaited<ReturnType<typeof loadBundle>>): CompatibilityCandidate | null {
  const { profile, loc, faith, edu, mi, biz, interestRows } = bundle;
  if (!profile || !profile.dateOfBirth) return null;
  return {
    userId: profile.userId,
    age: ageFromDob(profile.dateOfBirth),
    gender: profile.gender,
    country: loc?.country ?? "",
    region: loc?.region ?? null,
    city: loc?.city ?? null,
    willingToRelocate: loc?.willingToRelocate ?? false,
    faithImportance: faith?.faithImportance ?? "EXPLORING",
    denomination: faith?.denomination ?? null,
    educationLevel: edu?.level ?? null,
    seriouslySeekingMarriage: mi?.seriouslySeekingMarriage ?? false,
    marriageTimeframe: mi?.timeframe ?? "WHEN_RIGHT_PERSON_FOUND",
    wantsChildren: mi?.wantsChildren ?? null,
    hasChildrenAlready: mi?.hasChildrenAlready ?? false,
    interestIds: (interestRows ?? []).map((r: any) => r.interestId),
    ownsBusiness: biz?.ownsBusiness ?? false,
    lifeGoals: profile.lifeGoals ?? null,
    familyValues: profile.familyValues ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const authedUser = await getAuthedUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (userId === authedUser.id) {
    return NextResponse.json({ error: "Cannot view your own profile via discovery" }, { status: 400 });
  }

  const admin = getAdminClient();

  const [{ data: viewerUser }, { data: targetUser }] = await Promise.all([
    admin.from("users").select("status").eq("id", authedUser.id).single(),
    admin.from("users").select("status").eq("id", userId).single(),
  ]);
  if (!viewerUser || viewerUser.status !== "ACTIVE") {
    return NextResponse.json({ error: "Account is not active" }, { status: 403 });
  }
  if (!targetUser || targetUser.status !== "ACTIVE") {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const [{ data: blockedByMe }, { data: blockedMe }] = await Promise.all([
    admin.from("blocks").select("id").eq("blockerId", authedUser.id).eq("blockedId", userId).maybeSingle(),
    admin.from("blocks").select("id").eq("blockerId", userId).eq("blockedId", authedUser.id).maybeSingle(),
  ]);
  if (blockedByMe || blockedMe) {
    return NextResponse.json({ error: "Profile not available" }, { status: 403 });
  }

  const [viewerBundle, targetBundle] = await Promise.all([
    loadBundle(admin, authedUser.id),
    loadBundle(admin, userId),
  ]);

  if (!targetBundle.profile || !targetBundle.profile.isDiscoverable) {
    return NextResponse.json({ error: "Profile not available" }, { status: 404 });
  }

  const viewerCandidate = toCandidate(viewerBundle);
  const targetCandidate = toCandidate(targetBundle);

  const viewerGender: Gender | undefined = viewerBundle.profile?.gender;
  if (viewerGender && targetBundle.profile.gender === viewerGender) {
    return NextResponse.json({ error: "Profile not available" }, { status: 403 });
  }

  let compatibility = null;
  if (viewerCandidate && targetCandidate) {
    const result = scoreCompatibility(viewerCandidate, targetCandidate);
    compatibility = { score: result.score, breakdown: result.breakdown };
  }

  const [{ data: isSavedRow }, { data: connectionRow }, { data: introRow }] = await Promise.all([
    admin
      .from("saved_profiles")
      .select("id")
      .eq("userId", authedUser.id)
      .eq("savedProfileUserId", userId)
      .maybeSingle(),
    admin
      .from("connections")
      .select("id, currentStage")
      .or(
        `and(userAId.eq.${authedUser.id},userBId.eq.${userId}),and(userAId.eq.${userId},userBId.eq.${authedUser.id})`
      )
      .maybeSingle(),
    admin
      .from("introduction_requests")
      .select("id, status, requesterId")
      .or(
        `and(requesterId.eq.${authedUser.id},recipientId.eq.${userId}),and(requesterId.eq.${userId},recipientId.eq.${authedUser.id})`
      )
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let photoUrl: string | null = null;
  if (targetBundle.profile.headlinePhotoKey) {
    const { data } = await admin.storage
      .from("profile-photos")
      .createSignedUrl(targetBundle.profile.headlinePhotoKey, 3600);
    photoUrl = data?.signedUrl ?? null;
  }

  const p = targetBundle.profile;
  const response = {
    id: userId,
    displayName: p.displayName,
    age: p.dateOfBirth ? ageFromDob(p.dateOfBirth) : null,
    headlinePhotoUrl: photoUrl,
    lifeGoals: p.lifeGoals,
    familyValues: p.familyValues,
    location: p.showExactLocation
      ? {
          country: targetBundle.loc?.country ?? null,
          region: targetBundle.loc?.region ?? null,
          city: targetBundle.loc?.city ?? null,
        }
      : { country: targetBundle.loc?.country ?? null, region: null, city: null },
    willingToRelocate: targetBundle.loc?.willingToRelocate ?? false,
    faith: {
      importance: targetBundle.faith?.faithImportance ?? null,
      denomination: targetBundle.faith?.denomination ?? null,
    },
    education: {
      level: targetBundle.edu?.level ?? null,
      fieldOfStudy: targetBundle.edu?.fieldOfStudy ?? null,
    },
    occupation: p.showOccupationDetails
      ? { jobTitle: targetBundle.occ?.jobTitle ?? null, employer: targetBundle.occ?.employer ?? null }
      : { jobTitle: null, employer: null, industry: targetBundle.occ?.industry ?? null },
    business: p.showBusinessDetails
      ? { ownsBusiness: targetBundle.biz?.ownsBusiness ?? false, businessName: targetBundle.biz?.businessName ?? null }
      : { ownsBusiness: targetBundle.biz?.ownsBusiness ?? false, businessName: null },
    marriageIntentions: {
      seriouslySeekingMarriage: targetBundle.mi?.seriouslySeekingMarriage ?? null,
      timeframe: targetBundle.mi?.timeframe ?? null,
      wantsChildren: targetBundle.mi?.wantsChildren ?? null,
      hasChildrenAlready: targetBundle.mi?.hasChildrenAlready ?? null,
    },
    interests: (targetBundle.interestRows ?? []).map((r: any) => r.interests?.name).filter(Boolean),
    compatibility,
    isSaved: !!isSavedRow,
    connection: connectionRow ? { id: connectionRow.id, currentStage: connectionRow.currentStage } : null,
    introductionRequest: introRow
      ? { id: introRow.id, status: introRow.status, direction: introRow.requesterId === authedUser.id ? "sent" : "received" }
      : null,
    disclaimer:
      "Compatibility is guidance based on stated preferences and profile information — it is not a guarantee or prediction of a successful relationship.",
  };

  return NextResponse.json(response);
}
