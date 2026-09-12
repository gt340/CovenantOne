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

/**
 * "Confirm" does NOT punish anyone — it converts the automated flag
 * into a normal, human-driven report + moderation case, which then goes
 * through the exact same TRIAGE → INVESTIGATION → ACTION workflow as
 * any member-filed report. A human still has to investigate and decide
 * on any actual consequence via the existing case-actions route. This
 * is what keeps the automated detector a flagging system only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { decision?: "CONFIRMED" | "DISMISSED" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.decision !== "CONFIRMED" && body.decision !== "DISMISSED") {
    return NextResponse.json({ error: "decision must be 'CONFIRMED' or 'DISMISSED'" }, { status: 400 });
  }

  const { data: flag, error: fetchError } = await supabase
    .from("content_flags")
    .select("id, status, contentType, contentId, flaggedUserId, category")
    .eq("id", id)
    .single();
  if (fetchError || !flag) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  }
  if (flag.status !== "PENDING_REVIEW") {
    return NextResponse.json({ error: `Flag is already ${flag.status.toLowerCase()}` }, { status: 409 });
  }

  let resultingCaseId: string | null = null;

  if (body.decision === "CONFIRMED") {
    const { data: report, error: reportError } = await supabase
      .from("reports")
      .insert({
        reporterId: user.id, // the reviewing moderator is the system-side reporter of record
        reportedUserId: flag.flaggedUserId,
        category: flag.category,
        description: `Auto-flagged content confirmed by a moderator for human investigation (source: automated keyword heuristic).`,
        relatedContentType: flag.contentType,
        relatedContentId: flag.contentId,
        status: "UNDER_REVIEW",
      })
      .select()
      .single();
    if (reportError) {
      return NextResponse.json({ error: reportError.message }, { status: 500 });
    }

    const { data: modCase, error: caseError } = await supabase
      .from("moderation_cases")
      .insert({ reportId: report.id, assignedModeratorId: user.id, status: "OPEN", priority: "NORMAL" })
      .select()
      .single();
    if (caseError) {
      return NextResponse.json({ error: caseError.message }, { status: 500 });
    }
    resultingCaseId = modCase.id;
  }

  const { data: updatedFlag, error: updateError } = await supabase
    .from("content_flags")
    .update({
      status: body.decision,
      reviewedByUserId: user.id,
      reviewedAt: new Date().toISOString(),
      resultingCaseId,
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    actorUserId: user.id,
    action: "CONTENT_FLAG_REVIEWED",
    targetType: "content_flag",
    targetId: id,
    metadata: { decision: body.decision, resultingCaseId },
  });

  return NextResponse.json(updatedFlag);
}
