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

type Action = "accept" | "decline" | "withdraw";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { action?: Action };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.action || !["accept", "decline", "withdraw"].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'accept', 'decline', or 'withdraw'" }, { status: 400 });
  }

  const { data: reqRow, error: fetchError } = await supabase
    .from("mentorship_requests")
    .select("id, menteeId, mentorId, status")
    .eq("id", id)
    .single();
  if (fetchError || !reqRow) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (reqRow.status !== "PENDING") {
    return NextResponse.json({ error: `Request is already ${reqRow.status.toLowerCase()}` }, { status: 409 });
  }

  const isMentee = reqRow.menteeId === user.id;
  if (body.action === "withdraw" && !isMentee) {
    return NextResponse.json({ error: "Only the mentee can withdraw a request" }, { status: 403 });
  }
  if ((body.action === "accept" || body.action === "decline") && isMentee) {
    return NextResponse.json({ error: "Only the mentor can accept or decline a request" }, { status: 403 });
  }

  const newStatus = body.action === "accept" ? "ACCEPTED" : body.action === "decline" ? "DECLINED" : "WITHDRAWN";

  // RLS enforces the mentor-side update via mentorship_requests_update_mentor
  // and the mentee-side via mentorship_requests_withdraw_mentee — either
  // way, an attempt outside your actual role on this request affects
  // zero rows and this returns a clear error rather than silently no-op'ing.
  const { data: updated, error: updateError } = await supabase
    .from("mentorship_requests")
    .update({ status: newStatus })
    .eq("id", id)
    .eq("status", "PENDING")
    .select()
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: "Could not update request — it may have just changed, or you may not have permission" }, { status: 409 });
  }

  return NextResponse.json(updated);
}
