import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const DEFAULT_PAGE_SIZE = 25;

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
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, role: null };
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  return { user, role: profile?.role ?? null };
}

// Standalone audit log browser (Phase 13 "Audit Logs" section) — every
// sensitive admin/moderator action across the platform already writes here
// (see the many DB triggers and explicit inserts documented across prior
// phases). This is the first UI that lets anyone actually search it.
export async function GET(request: NextRequest) {
  const { user, role } = await getAuthedRole();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!role || !ADMIN_ROLES.includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
  );
  const action = searchParams.get("action")?.trim();
  const targetType = searchParams.get("targetType")?.trim();
  const actorUserId = searchParams.get("actorUserId")?.trim();
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  const admin = getAdminClient();
  let query = admin
    .from("audit_logs")
    .select("id, actorUserId, action, targetType, targetId, metadata, ipAddress, createdAt", { count: "exact" });

  if (action) query = query.ilike("action", `%${action}%`);
  if (targetType) query = query.eq("targetType", targetType);
  if (actorUserId) query = query.eq("actorUserId", actorUserId);
  if (from) query = query.gte("createdAt", from);
  if (to) query = query.lte("createdAt", to);

  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  const { data: logs, count, error } = await query.order("createdAt", { ascending: false }).range(rangeFrom, rangeTo);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const actorIds = [...new Set((logs ?? []).map((l: any) => l.actorUserId).filter(Boolean))];
  const nameByActor = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await admin.from("member_profiles").select("userId, displayName").in("userId", actorIds);
    (profiles ?? []).forEach((p: any) => nameByActor.set(p.userId, p.displayName));
  }

  return NextResponse.json({
    logs: (logs ?? []).map((l: any) => ({ ...l, actorName: nameByActor.get(l.actorUserId) ?? l.actorUserId })),
    total: count ?? 0,
    page,
    pageSize,
  });
}
