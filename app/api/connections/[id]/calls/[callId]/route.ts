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

type Action = "accept" | "decline" | "end";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; callId: string }> }
) {
  const { callId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { action?: Action };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.action || !["accept", "decline", "end"].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'accept', 'decline', or 'end'" }, { status: 400 });
  }

  const { data: call, error: fetchError } = await supabase
    .from("calls")
    .select("id, status, startedAt")
    .eq("id", callId)
    .single();
  if (fetchError || !call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  let update: Record<string, any> = {};
  if (body.action === "accept") {
    if (call.status !== "INITIATED" && call.status !== "RINGING") {
      return NextResponse.json({ error: `Call is already ${call.status.toLowerCase()}` }, { status: 409 });
    }
    update = { status: "ACCEPTED", startedAt: new Date().toISOString() };
  } else if (body.action === "decline") {
    if (call.status !== "INITIATED" && call.status !== "RINGING") {
      return NextResponse.json({ error: `Call is already ${call.status.toLowerCase()}` }, { status: 409 });
    }
    update = { status: "DECLINED" };
  } else {
    const endedAt = new Date();
    const durationSeconds = call.startedAt
      ? Math.round((endedAt.getTime() - new Date(call.startedAt).getTime()) / 1000)
      : 0;
    update = { status: "ENDED", endedAt: endedAt.toISOString(), durationSeconds };
  }

  const { data: updated, error: updateError } = await supabase
    .from("calls")
    .update(update)
    .eq("id", callId)
    .select()
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "Could not update call" }, { status: 500 });
  }

  return NextResponse.json(updated);
}
