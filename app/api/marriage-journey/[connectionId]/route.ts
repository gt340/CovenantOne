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

// The journey row is created/advanced automatically by the sync_marriage_journey
// DB trigger when the connection's relationship_stages history actually records
// MARRIAGE_PREPARATION or MARRIED — there's no participant-created path, so a
// missing row here just means the connection hasn't reached that stage yet.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("marriage_journeys")
    .select("id, connectionId, preparationStartedAt, milestones, marriedAt, createdAt, updatedAt")
    .eq("connectionId", connectionId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ journey: data ?? null });
}

// Participants can maintain the milestones checklist once the journey exists.
// preparationStartedAt/marriedAt stay system-managed (set only by the trigger).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { milestones?: { name: string; completedAt: string | null }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.milestones)) {
    return NextResponse.json({ error: "milestones array is required" }, { status: 400 });
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
        {
          error:
            "No marriage journey yet for this connection — it starts automatically once the relationship reaches Marriage Preparation",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
