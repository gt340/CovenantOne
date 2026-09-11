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

const ACTION_TYPES = [
  "WARNING_ISSUED",
  "CONTENT_REMOVED",
  "ACCOUNT_SUSPENDED",
  "ACCOUNT_BANNED",
  "ACCOUNT_REINSTATED",
  "CASE_ESCALATED",
  "CASE_CLOSED",
  "NO_ACTION_TAKEN",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { actionType?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.actionType || !ACTION_TYPES.includes(body.actionType)) {
    return NextResponse.json({ error: `actionType must be one of: ${ACTION_TYPES.join(", ")}` }, { status: 400 });
  }

  // RLS (moderator_actions_insert_own) requires moderatorId = auth.uid()
  // AND moderator tier — a MEMBER attempting this is rejected by the
  // database itself.
  const { data: action, error } = await supabase
    .from("moderator_actions")
    .insert({ caseId, moderatorId: user.id, actionType: body.actionType, notes: body.notes?.trim() || null })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.actionType === "CASE_CLOSED") {
    await supabase
      .from("moderation_cases")
      .update({ status: "CLOSED", closedAt: new Date().toISOString() })
      .eq("id", caseId);
  } else if (body.actionType === "CASE_ESCALATED") {
    await supabase.from("moderation_cases").update({ status: "ESCALATED" }).eq("id", caseId);
  } else if (["WARNING_ISSUED", "CONTENT_REMOVED", "ACCOUNT_SUSPENDED", "ACCOUNT_BANNED", "ACCOUNT_REINSTATED"].includes(body.actionType)) {
    await supabase.from("moderation_cases").update({ status: "ACTION_TAKEN" }).eq("id", caseId);
  }

  // This action itself is also an auditable event, separate from the
  // narrower "viewed a conversation" log in the conversation route.
  await supabase.from("audit_logs").insert({
    actorUserId: user.id,
    action: "MODERATION_ACTION_TAKEN",
    targetType: "moderation_case",
    targetId: caseId,
    metadata: { actionType: body.actionType, notes: body.notes?.trim() || null },
  });

  return NextResponse.json(action, { status: 201 });
}
