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

const DEFAULT_MILESTONES = [
  { name: "Premarital counseling session 1", completedAt: null },
  { name: "Premarital counseling session 2", completedAt: null },
  { name: "Met each other's families", completedAt: null },
  { name: "Agreed on a wedding date", completedAt: null },
  { name: "Discussed living arrangements after marriage", completedAt: null },
  { name: "Discussed financial planning as a couple", completedAt: null },
];

// Marriage Journey: a structured milestone checklist for a connection that
// has reached marriage preparation. The row itself is created automatically
// by a DB trigger (sync_marriage_journey) the moment the connection's stage
// history records MARRIAGE_PREPARATION — there's no direct-create endpoint
// on purpose, since the journey should reflect verified relationship
// progress rather than being freely creatable by either participant.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("marriage_journeys")
    .select("id, connectionId, preparationStartedAt, milestones, marriedAt, createdAt, updatedAt")
    .eq("connectionId", connectionId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    // Not an error — the connection just hasn't reached MARRIAGE_PREPARATION
    // yet, so no journey row exists (and RLS would hide someone else's).
    return NextResponse.json({ journey: null });
  }

  return NextResponse.json({
    journey: {
      ...data,
      milestones: data.milestones && Array.isArray(data.milestones) && data.milestones.length > 0
        ? data.milestones
        : DEFAULT_MILESTONES,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { milestones?: { name: string; completedAt: string | null }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.milestones)) {
    return NextResponse.json({ error: "milestones must be an array" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("marriage_journeys")
    .update({ milestones: body.milestones })
    .eq("connectionId", connectionId)
    .select()
    .single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json(
        { error: "No marriage journey yet for this connection — it's created automatically once you reach Marriage Preparation." },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
