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

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");
  const mineOnly = searchParams.get("assignedToMe") === "true";

  // RLS on moderation_cases already restricts this to moderator tier —
  // a plain member's request here returns zero rows regardless of filters.
  let query = supabase
    .from("moderation_cases")
    .select("id, reportId, assignedModeratorId, status, priority, createdAt, closedAt");

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  } else {
    query = query.in("status", ["OPEN", "INVESTIGATING", "ESCALATED"]);
  }
  if (mineOnly) {
    query = query.eq("assignedModeratorId", user.id);
  }

  const { data: cases, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const reportIds = Array.from(new Set((cases ?? []).map((c: any) => c.reportId)));
  const { data: reports } = reportIds.length
    ? await supabase
        .from("reports")
        .select("id, reporterId, reportedUserId, category, description, status, createdAt")
        .in("id", reportIds)
    : { data: [] };
  const reportById = new Map((reports ?? []).map((r: any) => [r.id, r]));

  const enriched = (cases ?? [])
    .map((c: any) => ({ ...c, report: reportById.get(c.reportId) ?? null }))
    .sort((a: any, b: any) => {
      const p = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
      if (p !== 0) return p;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  return NextResponse.json({ cases: enriched });
}
