import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createProviderSession, CallingProviderNotConfiguredError } from "@/lib/callingProvider";

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

async function getOrCreateConversation(connectionId: string) {
  const admin = getAdminClient();
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("connectionId", connectionId)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: created, error } = await admin
    .from("conversations")
    .insert({ connectionId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: connection, error: connError } = await supabase
    .from("connections")
    .select("id, userAId, userBId")
    .eq("id", connectionId)
    .single();
  if (connError || !connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.userAId !== user.id && connection.userBId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getAdminClient();
  const { data: conversation } = await admin
    .from("conversations")
    .select("id")
    .eq("connectionId", connectionId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json({ calls: [] });
  }

  const { data: calls, error } = await supabase
    .from("calls")
    .select("id, initiatorId, type, status, startedAt, endedAt, durationSeconds, createdAt")
    .eq("conversationId", conversation.id)
    .order("createdAt", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ calls: calls ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { type?: "AUDIO" | "VIDEO" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.type !== "AUDIO" && body.type !== "VIDEO") {
    return NextResponse.json({ error: "type must be 'AUDIO' or 'VIDEO'" }, { status: 400 });
  }

  const { data: connection, error: connError } = await supabase
    .from("connections")
    .select("id, userAId, userBId, status")
    .eq("id", connectionId)
    .single();
  if (connError || !connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.userAId !== user.id && connection.userBId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (connection.status !== "ACTIVE") {
    return NextResponse.json({ error: "This connection is no longer active" }, { status: 409 });
  }

  let conversationId: string;
  try {
    conversationId = await getOrCreateConversation(connectionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load conversation" }, { status: 500 });
  }

  const { data: call, error: callError } = await supabase
    .from("calls")
    .insert({ conversationId, initiatorId: user.id, type: body.type, status: "INITIATED" })
    .select()
    .single();
  if (callError) {
    return NextResponse.json({ error: callError.message }, { status: 500 });
  }

  // Real signaling record created above. Media transport is a separate,
  // honestly-gated concern — see src/lib/callingProvider.ts.
  try {
    const providerSessionId = await createProviderSession(call.id, body.type);
    await supabase.from("calls").update({ providerSessionId }).eq("id", call.id);
    return NextResponse.json({ ...call, providerConnected: true });
  } catch (err) {
    if (err instanceof CallingProviderNotConfiguredError) {
      return NextResponse.json({
        ...call,
        providerConnected: false,
        message:
          "Your call request was recorded, but this platform isn't connected to a calling provider yet, so audio/video can't actually be transmitted. This is a known, clearly-marked gap — not a bug.",
      });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not start the call" }, { status: 500 });
  }
}
