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

// Controlled invitation: the host adds another member directly to the guest
// list (event_attendees_insert_host RLS policy), distinct from the
// self-serve RSVP flow used for open COMMUNITY events.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.userId?.trim()) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("event_attendees")
    .insert({ eventId: id, userId: body.userId.trim(), invitedByUserId: user.id })
    .select()
    .single();

  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "That member is already on the guest list" }, { status: 409 });
    }
    if ((error as any).code === "PGRST116" || (error as any).code === "42501") {
      return NextResponse.json({ error: "Only the host can invite guests to this event" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
