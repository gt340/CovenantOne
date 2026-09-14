import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

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

  let body: { actionType?: string; notes?: string; suspensionDays?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.actionType || !ACTION_TYPES.includes(body.actionType)) {
    return NextResponse.json({ error: `actionType must be one of: ${ACTION_TYPES.join(", ")}` }, { status: 400 });
  }
  if (body.actionType === "ACCOUNT_SUSPENDED" && (!body.suspensionDays || body.suspensionDays <= 0)) {
    return NextResponse.json({ error: "suspensionDays (a positive number) is required for a suspension" }, { status: 400 });
  }

  const { data: modCase, error: caseFetchError } = await supabase
    .from("moderation_cases")
    .select("id, reportId, assignedModeratorId")
    .eq("id", caseId)
    .single();
  if (caseFetchError || !modCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  // RLS (moderator_actions_insert_own) requires moderatorId = auth.uid()
  // AND moderator tier — a MEMBER attempting this is rejected by the
  // database itself. This insert stays on the caller's own session.
  const { data: action, error } = await supabase
    .from("moderator_actions")
    .insert({ caseId, moderatorId: user.id, actionType: body.actionType, notes: body.notes?.trim() || null })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Applying the actual account-status consequence needs a service-role
  // client: `users` only has an UPDATE policy for admin-tier
  // (private.is_admin_tier(), i.e. ADMIN/SUPER_ADMIN), not
  // SAFETY_MODERATOR — so a safety moderator's own session would
  // silently update zero rows here. The REAL authorization boundary for
  // this is the enforce_status_transition_rules trigger, which
  // independently requires SAFETY_MODERATOR tier or above and fires
  // regardless of which client performs the write — so using a
  // privileged client here does not weaken enforcement, it just reaches
  // the write path RLS wasn't set up to allow for this tier.
  let statusChangeError: string | null = null;
  let affectedUserId: string | null = null;

  if (["ACCOUNT_SUSPENDED", "ACCOUNT_BANNED", "ACCOUNT_REINSTATED"].includes(body.actionType)) {
    const { data: report } = await supabase
      .from("reports")
      .select("reportedUserId")
      .eq("id", modCase.reportId)
      .single();
    affectedUserId = report?.reportedUserId ?? null;

    if (affectedUserId) {
      const update: Record<string, any> = {};
      if (body.actionType === "ACCOUNT_SUSPENDED") {
        const until = new Date();
        until.setDate(until.getDate() + (body.suspensionDays ?? 7));
        update.status = "SUSPENDED";
        update.suspendedUntil = until.toISOString();
      } else if (body.actionType === "ACCOUNT_BANNED") {
        update.status = "BANNED";
        update.suspendedUntil = null;
      } else if (body.actionType === "ACCOUNT_REINSTATED") {
        update.status = "ACTIVE";
        update.suspendedUntil = null;
      }

      const admin = getAdminClient();
      const { data: updatedRows, error: userUpdateError } = await admin
        .from("users")
        .update(update)
        .eq("id", affectedUserId)
        .select("id");

      if (userUpdateError) {
        statusChangeError = userUpdateError.message;
      } else if (!updatedRows || updatedRows.length === 0) {
        // The trigger itself rejected it (caller wasn't actually
        // SAFETY_MODERATOR tier+ at the DB level) — surface this
        // rather than silently reporting success.
        statusChangeError = "Status change was not applied — the enforce_status_transition_rules trigger rejected it.";
      } else {
        await supabase.from("notifications").insert({
          userId: affectedUserId,
          type: "MODERATION_UPDATE",
          payload: {
            actionType: body.actionType,
            caseId,
            notes: body.notes?.trim() || null,
            suspendedUntil: update.suspendedUntil ?? null,
          },
        });
      }
    }
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
    if (body.actionType === "WARNING_ISSUED" && affectedUserId) {
      await supabase.from("notifications").insert({
        userId: affectedUserId,
        type: "MODERATION_UPDATE",
        payload: { actionType: body.actionType, caseId, notes: body.notes?.trim() || null },
      });
    }
  }

  await supabase.from("audit_logs").insert({
    actorUserId: user.id,
    action: "MODERATION_ACTION_TAKEN",
    targetType: "moderation_case",
    targetId: caseId,
    metadata: { actionType: body.actionType, notes: body.notes?.trim() || null, affectedUserId, statusChangeError },
  });

  if (statusChangeError) {
    return NextResponse.json(
      { ...action, warning: "Action recorded, but applying the account status change failed: " + statusChangeError },
      { status: 200 }
    );
  }

  return NextResponse.json(action, { status: 201 });
}
