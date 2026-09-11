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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

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

  const otherUserId = connection.userAId === user.id ? connection.userBId : connection.userAId;

  const { error: blockError } = await supabase
    .from("blocks")
    .insert({ blockerId: user.id, blockedId: otherUserId });
  // Ignore a duplicate-block conflict — the goal (being blocked) is already achieved.
  if (blockError && blockError.code !== "23505") {
    return NextResponse.json({ error: blockError.message }, { status: 500 });
  }

  if (connection.status === "ACTIVE") {
    await supabase
      .from("connections")
      .update({ status: "ENDED", pendingStage: null, pendingStageProposedByUserId: null, pendingStageProposedAt: null })
      .eq("id", connectionId);

    await supabase.from("relationship_stages").insert({
      connectionId,
      stage: "ENDED",
      initiatedByUserId: user.id,
      notes: "Connection ended due to block.",
    });
  }

  return NextResponse.json({ blocked: true, connectionEnded: true });
}
