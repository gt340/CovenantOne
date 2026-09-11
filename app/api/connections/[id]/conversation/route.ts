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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { action?: "archive" | "unarchive" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.action !== "archive" && body.action !== "unarchive") {
    return NextResponse.json({ error: "action must be 'archive' or 'unarchive'" }, { status: 400 });
  }

  // Confirm participancy on the caller's own session before touching
  // anything with the privileged client.
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
  let { data: conversation } = await admin
    .from("conversations")
    .select("id")
    .eq("connectionId", connectionId)
    .maybeSingle();

  if (!conversation) {
    const { data: created, error: createError } = await admin
      .from("conversations")
      .insert({ connectionId })
      .select("id")
      .single();
    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
    conversation = created;
  }

  const { data: updated, error: updateError } = await admin
    .from("conversations")
    .update({ isArchived: body.action === "archive" })
    .eq("id", conversation.id)
    .select("id, isArchived")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
