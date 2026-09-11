import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { nextStage, STAGE_GUIDANCE, STAGE_LABELS, MEETING_SAFETY_GUIDANCE, Stage } from "@/lib/relationshipStages";

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

async function loadConnection(supabase: any, id: string) {
  return supabase
    .from("connections")
    .select(
      "id, userAId, userBId, status, currentStage, pendingStage, pendingStageProposedByUserId, pendingStageProposedAt, createdAt"
    )
    .eq("id", id)
    .single();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: connection, error } = await loadConnection(supabase, id);
  if (error || !connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const { data: history } = await supabase
    .from("relationship_stages")
    .select("stage, initiatedByUserId, notes, enteredAt, endedAt")
    .eq("connectionId", id)
    .order("enteredAt", { ascending: true });

  const otherUserId = connection.userAId === user.id ? connection.userBId : connection.userAId;
  const admin = getAdminClient();
  const { data: otherProfile } = await admin
    .from("member_profiles")
    .select("displayName, headlinePhotoKey")
    .eq("userId", otherUserId)
    .maybeSingle();

  let otherPhotoUrl: string | null = null;
  if (otherProfile?.headlinePhotoKey) {
    const { data: signed } = await admin.storage
      .from("profile-photos")
      .createSignedUrl(otherProfile.headlinePhotoKey, 3600);
    otherPhotoUrl = signed?.signedUrl ?? null;
  }

  const currentStage = connection.currentStage as Stage;
  const guidance = STAGE_GUIDANCE[currentStage] ?? null;
  const upcoming = nextStage(currentStage);

  return NextResponse.json({
    connection: {
      id: connection.id,
      status: connection.status,
      currentStage: connection.currentStage,
      currentStageLabel: STAGE_LABELS[currentStage] ?? connection.currentStage,
      pendingStage: connection.pendingStage,
      pendingStageLabel: connection.pendingStage ? STAGE_LABELS[connection.pendingStage as Stage] : null,
      proposedByMe: connection.pendingStageProposedByUserId === user.id,
      createdAt: connection.createdAt,
    },
    otherMember: { id: otherUserId, displayName: otherProfile?.displayName ?? "Member", headlinePhotoUrl: otherPhotoUrl },
    guidance,
    nextStage: upcoming,
    nextStageLabel: upcoming ? STAGE_LABELS[upcoming] : null,
    history: history ?? [],
    meetingSafetyGuidance: MEETING_SAFETY_GUIDANCE,
  });
}

type Action = "propose" | "confirm" | "cancel" | "end";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { action?: Action; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body.action;
  if (!action || !["propose", "confirm", "cancel", "end"].includes(action)) {
    return NextResponse.json({ error: "action must be 'propose', 'confirm', 'cancel', or 'end'" }, { status: 400 });
  }

  const { data: connection, error } = await loadConnection(supabase, id);
  if (error || !connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.userAId !== user.id && connection.userBId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (connection.status !== "ACTIVE" && action !== "end") {
    return NextResponse.json({ error: "This connection is no longer active" }, { status: 409 });
  }

  if (action === "propose") {
    if (connection.pendingStage) {
      return NextResponse.json({ error: "A stage change is already pending" }, { status: 409 });
    }
    const target = nextStage(connection.currentStage as Stage);
    if (!target) {
      return NextResponse.json({ error: "This connection is already at the final stage" }, { status: 409 });
    }
    const { data: updated, error: updateError } = await supabase
      .from("connections")
      .update({
        pendingStage: target,
        pendingStageProposedByUserId: user.id,
        pendingStageProposedAt: new Date().toISOString(),
      })
      .eq("id", id)
      .is("pendingStage", null) // race guard
      .select()
      .single();
    if (updateError || !updated) {
      return NextResponse.json({ error: "Could not propose the stage change — it may have just changed" }, { status: 409 });
    }
    return NextResponse.json({ connection: updated, message: `Proposed moving to ${STAGE_LABELS[target]}. Waiting for the other person to confirm.` });
  }

  if (action === "confirm") {
    if (!connection.pendingStage) {
      return NextResponse.json({ error: "There is no pending stage change to confirm" }, { status: 409 });
    }
    if (connection.pendingStageProposedByUserId === user.id) {
      return NextResponse.json(
        { error: "The other person needs to confirm this — you can't confirm your own proposal" },
        { status: 403 }
      );
    }
    const newStage = connection.pendingStage;
    const { data: updated, error: updateError } = await supabase
      .from("connections")
      .update({
        currentStage: newStage,
        pendingStage: null,
        pendingStageProposedByUserId: null,
        pendingStageProposedAt: null,
      })
      .eq("id", id)
      .eq("pendingStage", newStage) // race guard
      .select()
      .single();
    if (updateError || !updated) {
      return NextResponse.json({ error: "Could not confirm — it may have just changed" }, { status: 409 });
    }

    await supabase.from("relationship_stages").insert({
      connectionId: id,
      stage: newStage,
      initiatedByUserId: user.id,
      notes:
        (body.notes?.trim() ? body.notes.trim() + " — " : "") +
        `Mutually agreed: proposed by ${connection.pendingStageProposedByUserId}, confirmed by ${user.id}.`,
    });

    return NextResponse.json({ connection: updated, message: `Moved to ${STAGE_LABELS[newStage as Stage]}.` });
  }

  if (action === "cancel") {
    if (!connection.pendingStage) {
      return NextResponse.json({ error: "There is no pending stage change to cancel" }, { status: 409 });
    }
    const { data: updated, error: updateError } = await supabase
      .from("connections")
      .update({ pendingStage: null, pendingStageProposedByUserId: null, pendingStageProposedAt: null })
      .eq("id", id)
      .select()
      .single();
    if (updateError || !updated) {
      return NextResponse.json({ error: updateError?.message ?? "Could not cancel" }, { status: 500 });
    }
    return NextResponse.json({ connection: updated, message: "Pending stage change cancelled." });
  }

  // action === "end" — always available, from any stage, no justification required.
  const { data: updated, error: updateError } = await supabase
    .from("connections")
    .update({
      status: "ENDED",
      pendingStage: null,
      pendingStageProposedByUserId: null,
      pendingStageProposedAt: null,
    })
    .eq("id", id)
    .select()
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "Could not end the connection" }, { status: 500 });
  }

  await supabase.from("relationship_stages").insert({
    connectionId: id,
    stage: "ENDED",
    initiatedByUserId: user.id,
    notes: body.notes?.trim() || null,
  });

  return NextResponse.json({ connection: updated, message: "Connection ended." });
}
