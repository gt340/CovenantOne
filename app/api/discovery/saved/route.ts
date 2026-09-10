import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getAdminClient, ageFromDob } from "@/lib/discovery";

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

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getAdminClient();

  const { data: saved, error } = await admin
    .from("saved_profiles")
    .select("savedProfileUserId, createdAt")
    .eq("userId", authedUser.id)
    .order("createdAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const savedIds = (saved ?? []).map((s: any) => s.savedProfileUserId);
  if (savedIds.length === 0) {
    return NextResponse.json({ members: [] });
  }

  const { data: profiles } = await admin
    .from("member_profiles")
    .select(
      "userId, displayName, headlinePhotoKey, showExactLocation, showOccupationDetails, showBusinessDetails"
    )
    .in("userId", savedIds);

  const { data: dobRows } = await admin
    .from("member_profiles")
    .select("userId, dateOfBirth")
    .in("userId", savedIds);
  const dobByUser = new Map((dobRows ?? []).map((r: any) => [r.userId, r.dateOfBirth]));

  const { data: locations } = await admin
    .from("location_profiles")
    .select("userId, country, region, city")
    .in("userId", savedIds);
  const locByUser = new Map((locations ?? []).map((r: any) => [r.userId, r]));

  const { data: pairScores } = await admin
    .from("compatibility_scores")
    .select("userAId, userBId, score")
    .or(
      savedIds
        .map((id: string) => `and(userAId.eq.${authedUser.id},userBId.eq.${id}),and(userAId.eq.${id},userBId.eq.${authedUser.id})`)
        .join(",")
    );
  const scoreByUser = new Map(
    (pairScores ?? []).map((r: any) => [r.userAId === authedUser.id ? r.userBId : r.userAId, r.score])
  );

  const photoUrls = new Map<string, string>();
  await Promise.all(
    (profiles ?? []).map(async (p: any) => {
      if (!p.headlinePhotoKey) return;
      const { data } = await admin.storage.from("profile-photos").createSignedUrl(p.headlinePhotoKey, 3600);
      if (data?.signedUrl) photoUrls.set(p.userId, data.signedUrl);
    })
  );

  const profileByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p]));

  const members = savedIds
    .map((id: string) => {
      const p = profileByUser.get(id);
      if (!p) return null;
      const loc = locByUser.get(id);
      const dob = dobByUser.get(id);
      return {
        id,
        displayName: p.displayName,
        age: dob ? ageFromDob(dob) : null,
        headlinePhotoUrl: photoUrls.get(id) ?? null,
        location: p.showExactLocation
          ? { country: loc?.country ?? null, region: loc?.region ?? null, city: loc?.city ?? null }
          : { country: loc?.country ?? null, region: null, city: null },
        compatibility: scoreByUser.has(id) ? { score: scoreByUser.get(id) } : null,
        savedAt: (saved ?? []).find((s: any) => s.savedProfileUserId === id)?.createdAt ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ members });
}
