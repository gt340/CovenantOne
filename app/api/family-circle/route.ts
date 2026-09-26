import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getAuthedClientAndUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// Family Circle: controlled invitations bringing a trusted family member or
// mentor into limited visibility of a relationship. Gated by the
// enforce_family_invite_stage DB trigger — invitations are only accepted
// once the connection has moved past the earliest stages. The invitee is
// recorded by name/relationship, not linked to a platform account (they may
// not have one), so this is a record the two participants maintain together,
// not a portal the invitee logs into.
export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const connectionId = request.nextUrl.searchParams.get("connectionId");
  if (!connectionId) return NextResponse.json({ error: "connectionId is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("family_mentor_invitations")
    .select("id, connectionId, invitedByUserId, inviteeName, inviteeEmail, inviteeRelationship, accessScope, status, createdAt")
    .eq("connectionId", connectionId)
    .order("createdAt", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invitations: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    connectionId?: string;
    inviteeName?: string;
    inviteeEmail?: string;
    inviteeRelationship?: string;
    accessScope?: "VIEW_STAGE_ONLY" | "VIEW_STAGE_AND_SUMMARY";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.connectionId || !body.inviteeName?.trim() || !body.inviteeRelationship?.trim()) {
    return NextResponse.json(
      { error: "connectionId, inviteeName and inviteeRelationship are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("family_mentor_invitations")
    .insert({
      connectionId: body.connectionId,
      invitedByUserId: user.id,
      inviteeName: body.inviteeName.trim(),
      inviteeEmail: body.inviteeEmail?.trim() || null,
      inviteeRelationship: body.inviteeRelationship.trim(),
      accessScope: body.accessScope ?? "VIEW_STAGE_ONLY",
    })
    .select()
    .single();

  if (error) {
    if ((error as any).code === "P0001") {
      // The stage-gating trigger rejected this — message is already user-facing.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
