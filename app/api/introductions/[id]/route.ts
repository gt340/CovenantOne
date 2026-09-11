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

async function getAuthedUser() {
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
  return user;
}

type Action = "accept" | "decline" | "not_now" | "withdraw" | "block";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authedUser = await getAuthedUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { action?: Action; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body.action;
  if (!action || !["accept", "decline", "not_now", "withdraw", "block"].includes(action)) {
    return NextResponse.json(
      { error: "action must be 'accept', 'decline', 'not_now', 'withdraw', or 'block'" },
      { status: 400 }
    );
  }

  const admin = getAdminClient();

  const { data: introRequest, error: fetchError } = await admin
    .from("introduction_requests")
    .select("id, requesterId, recipientId, status, expiresAt")
    .eq("id", id)
    .single();

  if (fetchError || !introRequest) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const isRequester = introRequest.requesterId === authedUser.id;
  const isRecipient = introRequest.recipientId === authedUser.id;
  if (!isRequester && !isRecipient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only the recipient can accept, decline, not-now, or block. Only the
  // requester can withdraw their own request.
  if (["accept", "decline", "not_now", "block"].includes(action) && !isRecipient) {
    return NextResponse.json(
      { error: "Only the recipient can respond to this request" },
      { status: 403 }
    );
  }
  if (action === "withdraw" && !isRequester) {
    return NextResponse.json({ error: "Only the requester can withdraw a request" }, { status: 403 });
  }

  if (introRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: `Request is already ${introRequest.status.toLowerCase()}` },
      { status: 409 }
    );
  }
  if (introRequest.expiresAt && new Date(introRequest.expiresAt) < new Date()) {
    await admin.from("introduction_requests").update({ status: "EXPIRED" }).eq("id", id);
    return NextResponse.json({ error: "This request has expired" }, { status: 409 });
  }

  const statusByAction: Record<Action, string> = {
    accept: "ACCEPTED",
    decline: "DECLINED",
    not_now: "NOT_NOW",
    withdraw: "WITHDRAWN",
    block: "DECLINED", // blocking implies declining; the block itself is recorded separately
  };
  const newStatus = statusByAction[action];

  const { data: updated, error: updateError } = await admin
    .from("introduction_requests")
    .update({ status: newStatus, respondedAt: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "PENDING") // race guard
    .select()
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: "Could not update request — it may have just changed" }, { status: 409 });
  }

  let connection = null;
  let blocked = false;

  if (action === "accept") {
    const [userAId, userBId] = [introRequest.requesterId, introRequest.recipientId].sort();
    const { data: createdConnection, error: connectionError } = await admin
      .from("connections")
      .insert({
        userAId,
        userBId,
        originIntroductionId: introRequest.id,
        status: "ACTIVE",
        currentStage: "FRIENDSHIP",
      })
      .select()
      .single();

    if (connectionError) {
      return NextResponse.json(
        {
          ...updated,
          warning: "Request accepted but the connection could not be created: " + connectionError.message,
        },
        { status: 200 }
      );
    }
    connection = createdConnection;

    await admin.from("relationship_stages").insert({
      connectionId: createdConnection.id,
      stage: "FRIENDSHIP",
      initiatedByUserId: authedUser.id,
      notes: "Connection began after introduction was accepted.",
    });
  }

  if (action === "block") {
    const { error: blockError } = await admin.from("blocks").insert({
      blockerId: authedUser.id,
      blockedId: introRequest.requesterId,
    });
    blocked = !blockError;
  }

  return NextResponse.json({ ...updated, connection, blocked });
}
