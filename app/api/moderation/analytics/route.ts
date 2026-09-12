import { NextResponse } from "next/server";
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

function countBy<T extends Record<string, any>>(rows: T[], key: keyof T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = String(row[key] ?? "UNKNOWN");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export async function GET() {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // RLS (is_moderator_tier on reports/moderation_cases/moderator_actions)
  // already restricts all of these reads to moderator tier and above —
  // a plain member's request here returns zero rows for every query.
  const [{ data: reports }, { data: cases }, { data: actions }, { data: appeals }, { data: flags }] = await Promise.all([
    supabase.from("reports").select("id, category, status, createdAt"),
    supabase.from("moderation_cases").select("id, status, priority, createdAt, closedAt"),
    supabase.from("moderator_actions").select("id, actionType, createdAt"),
    supabase.from("appeals").select("id, status, createdAt"),
    supabase.from("content_flags").select("id, category, status, confidenceScore, createdAt"),
  ]);

  const closedCases = (cases ?? []).filter((c: any) => c.closedAt);
  const avgResolutionHours =
    closedCases.length > 0
      ? closedCases.reduce((sum: number, c: any) => {
          const hours = (new Date(c.closedAt).getTime() - new Date(c.createdAt).getTime()) / 3_600_000;
          return sum + hours;
        }, 0) / closedCases.length
      : null;

  return NextResponse.json({
    reports: {
      total: (reports ?? []).length,
      byCategory: countBy(reports ?? [], "category"),
      byStatus: countBy(reports ?? [], "status"),
    },
    cases: {
      total: (cases ?? []).length,
      byStatus: countBy(cases ?? [], "status"),
      byPriority: countBy(cases ?? [], "priority"),
      open: (cases ?? []).filter((c: any) => ["OPEN", "INVESTIGATING", "ESCALATED"].includes(c.status)).length,
      avgResolutionHours: avgResolutionHours !== null ? Math.round(avgResolutionHours * 10) / 10 : null,
    },
    actions: {
      total: (actions ?? []).length,
      byType: countBy(actions ?? [], "actionType"),
    },
    appeals: {
      total: (appeals ?? []).length,
      byStatus: countBy(appeals ?? [], "status"),
    },
    automatedFlags: {
      total: (flags ?? []).length,
      byStatus: countBy(flags ?? [], "status"),
      byCategory: countBy(flags ?? [], "category"),
      pendingReview: (flags ?? []).filter((f: any) => f.status === "PENDING_REVIEW").length,
    },
  });
}
