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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("family_mentor_invitations")
    .select("id, invitedByUserId, inviteeName, inviteeEmail, inviteeRelationship, accessScope, status, createdAt")
    .eq("connectionId", connectionId)
    .order("createdAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ invitations: data ?? [] });
}

// Family Circle: bring a trusted family member or mentor into the journey.
// PHASE 12: a DB trigger now blocks this while the connection is still at
// DISCOVERY/INTRODUCED/FRIENDSHIP/ENDED ("when a relationship reaches an
// appropriate stage...") — we surface that as a friendly 400 instead of a
// generic 500.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
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

  if (!body.inviteeName?.trim()) {
    return NextResponse.json({ error: "inviteeName is required" }, { status: 400 });
  }
  if (!body.inviteeRelationship?.trim()) {
    return NextResponse.json({ error: "inviteeRelationship is required (e.g. 'Mother', 'Pastor', 'Mentor')" }, { status: 400 });
  }
  const accessScope = body.accessScope ?? "VIEW_STAGE_ONLY";
  if (!["VIEW_STAGE_ONLY", "VIEW_STAGE_AND_SUMMARY"].includes(accessScope)) {
    return NextResponse.json({ error: "Invalid accessScope" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("family_mentor_invitations")
    .insert({
      connectionId,
      invitedByUserId: user.id,
      inviteeName: body.inviteeName.trim(),
      inviteeEmail: body.inviteeEmail?.trim() || null,
      inviteeRelationship: body.inviteeRelationship.trim(),
      accessScope,
      status: "PENDING",
    })
    .select()
    .single();

  if (error) {
    if ((error as any).code === "P0001") {
      // Our DB trigger raised a plain exception — its message is already
      // written to be shown directly to the member.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ...data,
      note:
        "This records your intent to involve this person. There is no automated email invitation yet — reach out to them directly to let them know.",
    },
    { status: 201 }
  );
}
