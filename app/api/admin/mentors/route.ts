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

// Admin-only mentor list: pending (isActive=false) and active mentors, with
// displayName joined in. Relies entirely on RLS (mentors_admin /
// member_profiles_admin_tier, both keyed on private.is_admin_tier()) — a
// non-admin session simply gets an empty/partial result, not an error, so
// this route is safe to leave un-gated in application code.
export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // "pending" | "active" | null (= all)

  let query = supabase
    .from("mentors")
    .select("id, userId, role, bio, specialties, capacity, isActive, approvedByUserId, createdAt")
    .order("createdAt", { ascending: false });

  if (status === "pending") query = query.eq("isActive", false);
  if (status === "active") query = query.eq("isActive", true);

  const { data: mentors, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = (mentors ?? []).map((m: any) => m.userId);
  const { data: profiles } = userIds.length
    ? await supabase.from("member_profiles").select("userId, displayName").in("userId", userIds)
    : { data: [] };
  const profileByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p]));

  const result = (mentors ?? []).map((m: any) => ({
    ...m,
    displayName: profileByUser.get(m.userId)?.displayName ?? "Unknown",
  }));

  return NextResponse.json({ mentors: result });
}
