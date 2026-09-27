import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

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

// Member detail: profile + verification + account status + connections +
// every report/case/action involving them, in one call — this is the
// "member details" + "case management history" + "moderation history"
// requirement from Phase 13, reusing the data already built up across
// Phases 3/5/7 rather than duplicating it.
//
// NOTE: lives under [userId] (not [id]) to match the sibling
// app/api/admin/members/[userId]/verify route — Next.js requires every
// dynamic segment at the same path level to share one slug name.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: id } = await params;
  const { user, role } = await getAuthedRole();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!role || !ADMIN_ROLES.includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = getAdminClient();

  const [{ data: profile }, { data: authUser }, { data: phone }, { data: identity }] = await Promise.all([
    admin.from("member_profiles").select("*").eq("userId", id).maybeSingle(),
    admin.from("users").select("id, role, status, createdAt, suspendedUntil, communityBannedUntil, communityBanReason").eq("id", id).maybeSingle(),
    admin.from("phone_verifications").select("status").eq("userId", id).maybeSingle(),
    admin.from("identity_verifications").select("status").eq("userId", id).maybeSingle(),
  ]);

  if (!profile || !authUser) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const { data: authRecord } = await admin.auth.admin.getUserById(id);

  const { data: connections } = await admin
    .from("connections")
    .select("id, userAId, userBId, currentStage, createdAt")
    .or(`userAId.eq.${id},userBId.eq.${id}`);

  const [{ data: reportsFiled }, { data: reportsAgainst }] = await Promise.all([
    admin.from("reports").select("id, category, status, description, relatedContentType, createdAt").eq("reporterId", id),
    admin.from("reports").select("id, category, status, description, relatedContentType, createdAt").eq("reportedUserId", id),
  ]);

  const reportIds = (reportsAgainst ?? []).map((r: any) => r.id);
  const { data: cases } = reportIds.length
    ? await admin.from("moderation_cases").select("id, reportId, status, priority, createdAt, closedAt").in("reportId", reportIds)
    : { data: [] as any[] };

  const caseIds = (cases ?? []).map((c: any) => c.id);
  const { data: actions } = caseIds.length
    ? await admin.from("moderator_actions").select("id, caseId, moderatorId, actionType, notes, createdAt").in("caseId", caseIds)
    : { data: [] as any[] };

  return NextResponse.json({
    profile,
    account: {
      ...authUser,
      email: authRecord?.user?.email ?? null,
      phoneVerified: phone?.status === "VERIFIED",
      identityVerified: identity?.status === "VERIFIED",
    },
    connections: connections ?? [],
    reportsFiled: reportsFiled ?? [],
    reportsAgainst: reportsAgainst ?? [],
    moderationCases: cases ?? [],
    moderatorActions: actions ?? [],
  });
}
