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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // RLS restricts this to moderator tier and above.
  const { data: modCase, error } = await supabase
    .from("moderation_cases")
    .select("id, reportId, assignedModeratorId, status, priority, createdAt, closedAt")
    .eq("id", caseId)
    .single();
  if (error || !modCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const { data: report } = await supabase
    .from("reports")
    .select("id, reporterId, reportedUserId, category, description, relatedContentType, relatedContentId, status, createdAt")
    .eq("id", modCase.reportId)
    .single();

  const { data: actions } = await supabase
    .from("moderator_actions")
    .select("id, moderatorId, actionType, notes, createdAt")
    .eq("caseId", caseId)
    .order("createdAt", { ascending: true });

  return NextResponse.json({ case: modCase, report: report ?? null, actions: actions ?? [] });
}
