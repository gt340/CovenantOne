import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const DEFAULT_PAGE_SIZE = 25;

// Service-role client: bypasses RLS, used only after the caller's admin
// role has been confirmed below. Never expose this key to the client.
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getAuthedRole() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // No-op in a route handler reading an existing session.
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, role: null };

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  return { user, role: profile?.role ?? null };
}

export async function GET(request: NextRequest) {
  const { user, role } = await getAuthedRole();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!role || !ADMIN_ROLES.includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
  );
  const search = searchParams.get("search")?.trim();
  const communityVerifiedParam = searchParams.get("communityVerified");

  const admin = getAdminClient();

  let query = admin
    .from("member_profiles")
    .select(
      "userId, displayName, communityVerified, users!member_profiles_userId_fkey(id, role, status, createdAt)",
      { count: "exact" }
    );

  if (search) {
    query = query.ilike("displayName", `%${search}%`);
  }
  if (communityVerifiedParam === "true" || communityVerifiedParam === "false") {
    query = query.eq("communityVerified", communityVerifiedParam === "true");
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: profiles, count, error } = await query
    .order("createdAt", { referencedTable: "users", ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = (profiles ?? []).map((p: any) => p.userId);

  // Phone / identity verification status, batched for this page only.
  const [{ data: phoneRows }, { data: identityRows }] = await Promise.all([
    admin.from("phone_verifications").select("userId, status").in("userId", userIds),
    admin.from("identity_verifications").select("userId, status").in("userId", userIds),
  ]);

  const phoneByUser = new Map((phoneRows ?? []).map((r: any) => [r.userId, r.status]));
  const identityByUser = new Map((identityRows ?? []).map((r: any) => [r.userId, r.status]));

  // Email lives in auth.users, not public.users — fetch via the Admin API.
  const emailByUser = new Map<string, string>();
  await Promise.all(
    userIds.map(async (id: string) => {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email) emailByUser.set(id, data.user.email);
    })
  );

  const members = (profiles ?? []).map((p: any) => {
    const u = p.users;
    return {
      id: p.userId,
      displayName: p.displayName,
      email: emailByUser.get(p.userId) ?? "",
      accountStatus: u?.status ?? "UNKNOWN",
      // A PENDING_VERIFICATION account hasn't confirmed email yet; the
      // auto-promote trigger moves it to ACTIVE on confirmation.
      emailVerified: u?.status !== "PENDING_VERIFICATION",
      phoneVerified: phoneByUser.get(p.userId) === "VERIFIED",
      identityVerified: identityByUser.get(p.userId) === "VERIFIED",
      communityVerified: p.communityVerified,
      createdAt: u?.createdAt ?? null,
    };
  });

  return NextResponse.json({
    members,
    total: count ?? 0,
    page,
    pageSize,
  });
}
