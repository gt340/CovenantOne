import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getAuthedClientAndUser() {
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
  return { supabase, user };
}

const MENTOR_ROLES = ["MARRIAGE_MENTOR", "FAMILY_MENTOR", "BUSINESS_MENTOR", "FINANCIAL_MENTOR"];

export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");
  const mine = searchParams.get("mine") === "true";

  let query = supabase
    .from("mentors")
    .select("id, userId, role, bio, specialties, capacity, isActive, createdAt");

  if (mine) {
    query = query.eq("userId", user.id);
  } else {
    query = query.eq("isActive", true);
    if (role) query = query.eq("role", role);
  }

  const { data: mentors, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = (mentors ?? []).map((m: any) => m.userId);
  const { data: profiles } = userIds.length
    ? await supabase.from("member_profiles").select("userId, displayName, headlinePhotoKey").in("userId", userIds)
    : { data: [] };
  const profileByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p]));

  const photoUrls = new Map<string, string>();
  await Promise.all(
    (profiles ?? []).map(async (p: any) => {
      if (!p.headlinePhotoKey) return;
      const { data: signed } = await supabase.storage.from("profile-photos").createSignedUrl(p.headlinePhotoKey, 3600);
      if (signed?.signedUrl) photoUrls.set(p.userId, signed.signedUrl);
    })
  );

  const result = (mentors ?? []).map((m: any) => ({
    ...m,
    displayName: profileByUser.get(m.userId)?.displayName ?? "Mentor",
    headlinePhotoUrl: photoUrls.get(m.userId) ?? null,
  }));

  return NextResponse.json({ mentors: result });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { role?: string; bio?: string; specialties?: string[]; capacity?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.role || !MENTOR_ROLES.includes(body.role)) {
    return NextResponse.json({ error: `role must be one of: ${MENTOR_ROLES.join(", ")}` }, { status: 400 });
  }

  const { data: existing } = await supabase.from("mentors").select("id").eq("userId", user.id).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "You already have a mentor profile" }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("mentors")
    .insert({
      userId: user.id,
      role: body.role,
      bio: body.bio?.trim() || null,
      specialties: body.specialties ?? [],
      capacity: body.capacity ?? 5,
      isActive: false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { ...data, note: "Your mentor profile has been submitted and is pending admin approval." },
    { status: 201 }
  );
                      }
