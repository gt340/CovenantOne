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

type Action = "accept" | "decline" | "withdraw";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authedUser = await getAuthedUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { action?: Action };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body.action;
  if (!action || !["accept", "decline", "withdraw"].includes(action)) {
    return NextResponse.json(
      { error: "action must be 'accept', 'decline', or 'withdraw'" },
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

  if (action === "accept" || action === "decline") {
    if (!isRecipient) {
      return NextResponse.json(
        { error: "Only the recipient can accept or decline a request" },
        { status: 403 }
      );
    }
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

  const newStatus = action === "accept" ? "ACCEPTED" : action === "decline" ? "DECLINED" : "WITHDRAWN";

  const { data: updated, error: updateError } = await admin
    .from("introduction_requests")
    .update({ status: newStatus, respondedAt: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "PENDING") // guards against a race with a second simultaneous response
    .select()
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: "Could not update request — it may have just changed" }, { status: 409 });
  }

  let connection = null;
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
      // The request is already marked ACCEPTED; surface the connection
      // failure separately so it can be retried/investigated rather than
      // silently leaving an accepted request with no connection.
      return NextResponse.json(
        {
          ...updated,
          warning: "Request accepted but the connection could not be created: " + connectionError.message,
        },
        { status: 200 }
      );
    }
    connection = createdConnection;
  }

  return NextResponse.json({ ...updated, connection });
}
