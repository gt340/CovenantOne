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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { decision?: "GRANTED" | "DENIED"; reviewNotes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.decision !== "GRANTED" && body.decision !== "DENIED") {
    return NextResponse.json({ error: "decision must be 'GRANTED' or 'DENIED'" }, { status: 400 });
  }

  const { data: appeal, error: fetchError } = await supabase
    .from("appeals")
    .select("id, caseId, submittedByUserId, status")
    .eq("id", id)
    .single();
  // RLS (appeals_select_moderator) means a non-moderator gets "not found"
  // here rather than a distinct forbidden error — it's genuinely
  // invisible to them, which is the correct behavior.
  if (fetchError || !appeal) {
    return NextResponse.json({ error: "Appeal not found" }, { status: 404 });
  }
  if (appeal.status !== "PENDING" && appeal.status !== "UNDER_REVIEW") {
    return NextResponse.json({ error: `Appeal is already ${appeal.status.toLowerCase()}` }, { status: 409 });
  }

  const { data: updatedAppeal, error: updateError } = await supabase
    .from("appeals")
    .update({
      status: body.decision,
      reviewedByUserId: user.id,
      reviewNotes: body.reviewNotes?.trim() || null,
      reviewedAt: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (updateError || !updatedAppeal) {
    return NextResponse.json({ error: updateError?.message ?? "Could not update appeal" }, { status: 500 });
  }

  if (body.decision === "GRANTED") {
    // Reversing the action means reinstating the account, if it was
    // suspended or banned as a result of this case.
    const { data: modCase } = await supabase
      .from("moderation_cases")
      .select("id, reportId")
      .eq("id", appeal.caseId)
      .single();
    if (modCase) {
      const { error: reinstateError } = await supabase
        .from("users")
        .update({ status: "ACTIVE", suspendedUntil: null })
        .eq("id", appeal.submittedByUserId);
      if (!reinstateError) {
        await supabase.from("moderator_actions").insert({
          caseId: appeal.caseId,
          moderatorId: user.id,
          actionType: "ACCOUNT_REINSTATED",
          notes: "Reinstated following a granted appeal.",
        });
        await supabase.from("notifications").insert({
          userId: appeal.submittedByUserId,
          type: "MODERATION_UPDATE",
          payload: { appealId: id, decision: "GRANTED", reviewNotes: body.reviewNotes?.trim() || null },
        });
      }
    }
  } else {
    await supabase.from("notifications").insert({
      userId: appeal.submittedByUserId,
      type: "MODERATION_UPDATE",
      payload: { appealId: id, decision: "DENIED", reviewNotes: body.reviewNotes?.trim() || null },
    });
  }

  // The appeal is the final step in the workflow — resolving it closes the case either way.
  await supabase
    .from("moderation_cases")
    .update({ status: "CLOSED", closedAt: new Date().toISOString() })
    .eq("id", appeal.caseId);

  await supabase.from("audit_logs").insert({
    actorUserId: user.id,
    action: "APPEAL_REVIEWED",
    targetType: "appeal",
    targetId: id,
    metadata: { decision: body.decision, caseId: appeal.caseId, reviewNotes: body.reviewNotes?.trim() || null },
  });

  return NextResponse.json(updatedAppeal);
}
