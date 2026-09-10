import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  scoreCompatibility,
  passesHardFilters,
  CompatibilityCandidate,
  PartnerPreferenceFilter,
  Gender,
} from "@/lib/compatibility";

const CANDIDATE_POOL_CAP = 300;

export function getAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

const SELECT_SHAPE = `
  id, status, createdAt,
  member_profiles!member_profiles_userId_fkey!inner(userId, displayName, gender, headlinePhotoKey, isDiscoverable, lifeGoals, familyValues, showExactLocation, showOccupationDetails, showBusinessDetails),
  location_profiles(country, region, city, willingToRelocate),
  faith_profiles(faithImportance, denomination),
  education_records(level, fieldOfStudy),
  occupations(jobTitle, employer, industry),
  business_info(ownsBusiness, businessName),
  marriage_intentions(seriouslySeekingMarriage, timeframe, wantsChildren, hasChildrenAlready),
  member_interests(interestId)
`;

function toCandidate(row: any): CompatibilityCandidate | null {
  const mp = row.member_profiles;
  if (!mp || !row.dateOfBirthSource) return null;
  return {
    userId: row.id,
    age: ageFromDob(row.dateOfBirthSource),
    gender: mp.gender,
    country: row.location_profiles?.country ?? "",
    region: row.location_profiles?.region ?? null,
    city: row.location_profiles?.city ?? null,
    willingToRelocate: row.location_profiles?.willingToRelocate ?? false,
    faithImportance: row.faith_profiles?.faithImportance ?? "EXPLORING",
    denomination: row.faith_profiles?.denomination ?? null,
    educationLevel: row.education_records?.level ?? null,
    seriouslySeekingMarriage: row.marriage_intentions?.seriouslySeekingMarriage ?? false,
    marriageTimeframe: row.marriage_intentions?.timeframe ?? "WHEN_RIGHT_PERSON_FOUND",
    wantsChildren: row.marriage_intentions?.wantsChildren ?? null,
    hasChildrenAlready: row.marriage_intentions?.hasChildrenAlready ?? false,
    interestIds: (row.member_interests ?? []).map((mi: any) => mi.interestId),
    ownsBusiness: row.business_info?.ownsBusiness ?? false,
    lifeGoals: mp.lifeGoals ?? null,
    familyValues: mp.familyValues ?? null,
  };
}

export interface DiscoveryParams {
  page: number;
  pageSize: number;
  nameSearch?: string;
  interestFilter?: string[];
  countryFilter?: string;
  ageMinOverride?: number;
  ageMaxOverride?: number;
}

export interface DiscoveryError {
  status: number;
  message: string;
}

export async function runDiscoverySearch(
  authedUserId: string,
  params: DiscoveryParams
): Promise<{ error: DiscoveryError } | { error: null; body: any }> {
  const admin = getAdminClient();

  const { data: viewerRow, error: viewerError } = await admin
    .from("users")
    .select(SELECT_SHAPE.replace("member_profiles!member_profiles_userId_fkey!inner", "member_profiles!member_profiles_userId_fkey"))
    .eq("id", authedUserId)
    .single();

  if (viewerError || !viewerRow || !(viewerRow as any).member_profiles) {
    return {
      error: {
        status: 400,
        message: "Complete your profile before browsing Find a Life Partner.",
      },
    };
  }
  if ((viewerRow as any).status !== "ACTIVE") {
    return { error: { status: 403, message: "Account is not active" } };
  }

  const { data: viewerProfileRow } = await admin
    .from("member_profiles")
    .select("gender, dateOfBirth")
    .eq("userId", authedUserId)
    .single();

  if (!viewerProfileRow) {
    return { error: { status: 400, message: "Profile not found" } };
  }

  const viewerGender: Gender = viewerProfileRow.gender;
  const viewerAge = ageFromDob(viewerProfileRow.dateOfBirth);
  const viewerCandidate = toCandidate({
    ...(viewerRow as any),
    dateOfBirthSource: viewerProfileRow.dateOfBirth,
  });
  if (!viewerCandidate) {
    return {
      error: { status: 400, message: "Profile not complete enough to score compatibility" },
    };
  }

  const { data: storedPrefs } = await admin
    .from("partner_preferences")
    .select(
      "preferredGender, minAge, maxAge, maxDistanceKm, requireSameFaith, minFaithImportance, minEducationLevel, openToChildrenAlready, openToRelocation"
    )
    .eq("userId", authedUserId)
    .single();

  const effectivePrefs: PartnerPreferenceFilter | null = storedPrefs
    ? {
        preferredGender: storedPrefs.preferredGender,
        minAge: params.ageMinOverride ?? storedPrefs.minAge,
        maxAge: params.ageMaxOverride ?? storedPrefs.maxAge,
        maxDistanceKm: storedPrefs.maxDistanceKm,
        requireSameFaith: storedPrefs.requireSameFaith,
        minFaithImportance: storedPrefs.minFaithImportance,
        minEducationLevel: storedPrefs.minEducationLevel,
        openToChildrenAlready: storedPrefs.openToChildrenAlready,
        openToRelocation: storedPrefs.openToRelocation,
      }
    : null;

  const [{ data: blocksA }, { data: blocksB }, { data: existingConnections }] = await Promise.all([
    admin.from("blocks").select("blockedId").eq("blockerId", authedUserId),
    admin.from("blocks").select("blockerId").eq("blockedId", authedUserId),
    admin
      .from("connections")
      .select("userAId, userBId")
      .or(`userAId.eq.${authedUserId},userBId.eq.${authedUserId}`),
  ]);
  const excludedIds = new Set<string>([authedUserId]);
  (blocksA ?? []).forEach((b: any) => excludedIds.add(b.blockedId));
  (blocksB ?? []).forEach((b: any) => excludedIds.add(b.blockerId));
  (existingConnections ?? []).forEach((c: any) => {
    excludedIds.add(c.userAId === authedUserId ? c.userBId : c.userAId);
  });

  const oppositeGender: Gender = viewerGender === "MALE" ? "FEMALE" : "MALE";

  const { data: candidateRows, error: candidatesError } = await admin
    .from("users")
    .select(SELECT_SHAPE)
    .eq("status", "ACTIVE")
    .eq("member_profiles.isDiscoverable", true)
    .eq("member_profiles.gender", oppositeGender)
    .neq("id", authedUserId)
    .limit(CANDIDATE_POOL_CAP);

  if (candidatesError) {
    return { error: { status: 500, message: candidatesError.message } };
  }

  const candidateUserIds = (candidateRows ?? [])
    .map((r: any) => r.id)
    .filter((id: string) => !excludedIds.has(id));

  const { data: dobRows } = await admin
    .from("member_profiles")
    .select("userId, dateOfBirth")
    .in("userId", candidateUserIds);
  const dobByUser = new Map((dobRows ?? []).map((r: any) => [r.userId, r.dateOfBirth]));

  const scored: Array<{ row: any; result: ReturnType<typeof scoreCompatibility> }> = [];

  for (const row of candidateRows ?? []) {
    if (!candidateUserIds.includes(row.id)) continue;
    const dob = dobByUser.get(row.id);
    if (!dob) continue;
    const candidate = toCandidate({ ...row, dateOfBirthSource: dob });
    if (!candidate) continue;

    if (!passesHardFilters(candidate, viewerGender, viewerAge, effectivePrefs)) continue;
    if (params.countryFilter && candidate.country.toLowerCase() !== params.countryFilter.toLowerCase()) continue;
    if (
      params.interestFilter?.length &&
      !params.interestFilter.some((id) => candidate.interestIds.includes(id))
    ) {
      continue;
    }
    if (params.nameSearch && !(row.member_profiles as any)?.displayName?.toLowerCase().includes(params.nameSearch)) {
      continue;
    }

    const result = scoreCompatibility(viewerCandidate, candidate);
    scored.push({ row, result });
  }

  scored.sort((a, b) => b.result.score - a.result.score);

  const from = (params.page - 1) * params.pageSize;
  const pageSlice = scored.slice(from, from + params.pageSize);

  const photoUrls = new Map<string, string>();
  await Promise.all(
    pageSlice.map(async ({ row }) => {
      const key = row.member_profiles.headlinePhotoKey;
      if (!key) return;
      const { data } = await admin.storage.from("profile-photos").createSignedUrl(key, 3600);
      if (data?.signedUrl) photoUrls.set(row.id, data.signedUrl);
    })
  );

  const members = pageSlice.map(({ row, result }) => {
    const mp = row.member_profiles;
    const occ = row.occupations;
    const biz = row.business_info;
    const loc = row.location_profiles;

    return {
      id: row.id,
      displayName: mp.displayName,
      age: dobByUser.get(row.id) ? ageFromDob(dobByUser.get(row.id)) : null,
      headlinePhotoUrl: photoUrls.get(row.id) ?? null,
      location: mp.showExactLocation
        ? { country: loc?.country ?? null, region: loc?.region ?? null, city: loc?.city ?? null }
        : { country: loc?.country ?? null, region: null, city: null },
      occupation: mp.showOccupationDetails
        ? { jobTitle: occ?.jobTitle ?? null, employer: occ?.employer ?? null }
        : { jobTitle: null, employer: null, industry: occ?.industry ?? null },
      business: mp.showBusinessDetails
        ? { ownsBusiness: biz?.ownsBusiness ?? false, businessName: biz?.businessName ?? null }
        : { ownsBusiness: biz?.ownsBusiness ?? false, businessName: null },
      compatibility: { score: result.score, breakdown: result.breakdown },
    };
  });

  const cacheRows = pageSlice.map(({ row, result }) => {
    const [userAId, userBId] = [authedUserId, row.id].sort();
    return {
      userAId,
      userBId,
      score: result.score,
      factorBreakdown: result.breakdown,
      computedAt: new Date().toISOString(),
    };
  });
  if (cacheRows.length) {
    admin
      .from("compatibility_scores")
      .upsert(cacheRows, { onConflict: "userAId,userBId" })
      .then(() => {});
  }

  return {
    error: null,
    body: {
      members,
      total: scored.length,
      page: params.page,
      pageSize: params.pageSize,
      disclaimer:
        "Compatibility is guidance based on stated preferences and profile information — it is not a guarantee or prediction of a successful relationship.",
    },
  };
}
