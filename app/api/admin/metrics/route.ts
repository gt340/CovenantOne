import { NextResponse } from "next/server";
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

function countBy(rows: any[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = String(row[key] ?? "UNKNOWN");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// Phase 13 dashboard metrics — every figure listed in the spec, in one call.
// ADMIN tier only: this is org-wide business/financial visibility, a step
// above the operational MODERATOR/SAFETY_MODERATOR tools under /moderation.
export async function GET() {
  const { user, role } = await getAuthedRole();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!role || !ADMIN_ROLES.includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = getAdminClient();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const nowIso = now.toISOString();

  const [
    { data: users },
    { data: profiles },
    { data: connections },
    { data: reports },
    { data: campaigns },
    { data: donations },
    { data: events },
    { data: mentors },
    { data: mentorshipRequests },
    { data: mentorSessions },
  ] = await Promise.all([
    admin.from("users").select("id, status, role, createdAt, suspendedUntil, communityBannedUntil"),
    admin.from("member_profiles").select("userId, gender, communityVerified"),
    admin.from("connections").select("id, currentStage"),
    admin.from("reports").select("id, status"),
    admin.from("fundraising_campaigns").select("id, status"),
    admin.from("donations").select("id, status, amountCents"),
    admin.from("events").select("id, eventType, startAt, isCancelled"),
    admin.from("mentors").select("id, status"),
    admin.from("mentorship_requests").select("id, status"),
    admin.from("mentor_sessions").select("id, status"),
  ]);

  const genderByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p.gender]));
  const verifiedCount = (profiles ?? []).filter((p: any) => p.communityVerified).length;
  const genderCounts = countBy((profiles ?? []).map((p: any) => ({ gender: p.gender })), "gender");

  const totalMembers = (users ?? []).filter((u: any) => u.status !== "DELETED").length;
  const activeMembers = (users ?? []).filter((u: any) => u.status === "ACTIVE").length;
  const newRegistrations7d = (users ?? []).filter((u: any) => u.createdAt >= sevenDaysAgo).length;
  const newRegistrations30d = (users ?? []).filter((u: any) => u.createdAt >= thirtyDaysAgo).length;
  const suspensions = (users ?? []).filter(
    (u: any) => u.status === "SUSPENDED" || (u.suspendedUntil && u.suspendedUntil > nowIso)
  ).length;
  const bans = (users ?? []).filter((u: any) => u.status === "BANNED").length;
  const communityBans = (users ?? []).filter((u: any) => u.communityBannedUntil && u.communityBannedUntil > nowIso).length;

  const donationsCompleted = (donations ?? []).filter((d: any) => d.status === "COMPLETED");
  const donationTotalCents = donationsCompleted.reduce((sum: number, d: any) => sum + (d.amountCents ?? 0), 0);

  return NextResponse.json({
    generatedAt: nowIso,
    members: {
      total: totalMembers,
      byGender: genderCounts,
      verified: verifiedCount,
      active: activeMembers,
      newRegistrations7d,
      newRegistrations30d,
    },
    connections: {
      total: (connections ?? []).length,
      byStage: countBy(connections ?? [], "currentStage"),
    },
    reports: {
      total: (reports ?? []).length,
      open: (reports ?? []).filter((r: any) => r.status === "OPEN" || r.status === "UNDER_REVIEW").length,
    },
    safety: {
      suspensions,
      bans,
      communityBans,
    },
    fundraising: {
      campaigns: {
        total: (campaigns ?? []).length,
        byStatus: countBy(campaigns ?? [], "status"),
      },
      donations: {
        completedCount: donationsCompleted.length,
        completedTotalCents: donationTotalCents,
      },
    },
    events: {
      total: (events ?? []).length,
      upcoming: (events ?? []).filter((e: any) => !e.isCancelled && e.startAt >= nowIso).length,
      byType: countBy(events ?? [], "eventType"),
    },
    mentorship: {
      mentors: (mentors ?? []).length,
      activeMentors: (mentors ?? []).filter((m: any) => m.status === "ACTIVE" || m.status === "APPROVED").length,
      requests: (mentorshipRequests ?? []).length,
      sessions: (mentorSessions ?? []).length,
    },
  });
}
