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

export async function GET() {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("appeals")
    .select("id, caseId, reason, status, reviewNotes, createdAt, reviewedAt")
    .eq("submittedByUserId", user.id)
    .order("createdAt", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ appeals: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { caseId?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.caseId) return NextResponse.json({ error: "caseId is required" }, { status: 400 });
  if (!body.reason?.trim()) return NextResponse.json({ error: "reason is required" }, { status: 400 });

  // Business-rule checks: this route runs on the user's own session, so
  // these reads are already scoped by whatever RLS allows a plain member
  // to see (a case they're the reported party on, via the underlying
  // report). If the case isn't visible or doesn't qualify, we fail with
  // a clear message rather than relying only on the insert policy.
  const { data: modCase, error: caseError } = await supabase
    .from("moderation_cases")
    .select("id, status, reportId")
    .eq("id", body.caseId)
    .single();
  if (caseError || !modCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  if (modCase.status !== "ACTION_TAKEN") {
    return NextResponse.json(
      { error: "This case doesn't currently have an actionable outcome to appeal" },
      { status: 409 }
    );
  }

  const { data: report } = await supabase.from("reports").select("reportedUserId").eq("id", modCase.reportId).single();
  if (!report || report.reportedUserId !== user.id) {
    return NextResponse.json({ error: "You can only appeal a case where an action was taken against you" }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from("appeals")
    .select("id")
    .eq("caseId", body.caseId)
    .eq("submittedByUserId", user.id)
    .in("status", ["PENDING", "UNDER_REVIEW"])
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "You already have a pending appeal for this case" }, { status: 409 });
  }

  const { data: appeal, error } = await supabase
    .from("appeals")
    .insert({ caseId: body.caseId, submittedByUserId: user.id, reason: body.reason.trim(), status: "PENDING" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(appeal, { status: 201 });
}
