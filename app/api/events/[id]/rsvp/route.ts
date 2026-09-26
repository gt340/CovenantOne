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

// POST with no body: self-RSVP (open to anyone who can already see the event).
// POST { targetUserId }: the host adding someone to the guest list directly —
// this is the "controlled invitation" path for private family events (a
// wedding/engagement/birthday guest list the host builds, not just opens up
// to self-serve RSVP). Backed by the event_attendees_insert_host RLS policy,
// so a non-host attempt here is simply rejected by the database.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let targetUserId: string | undefined;
  try {
    const body = await request.json();
    targetUserId = body?.targetUserId || undefined;
  } catch {
    // no body — plain self-RSVP
  }

  const insert: Record<string, unknown> = { eventId: id, userId: targetUserId || user.id };
  if (targetUserId && targetUserId !== user.id) {
    insert.invitedByUserId = user.id;
  }

  const { data, error } = await supabase.from("event_attendees").insert(insert).select().single();

  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "That person is already on the guest list" }, { status: 409 });
    }
    if ((error as any).code === "42501") {
      return NextResponse.json({ error: "Only the host can invite other guests" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
