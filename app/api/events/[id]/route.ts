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

// Event detail: description/date/time/location/host/guest list/RSVP status.
// RLS scopes visibility automatically — COMMUNITY events are open to any
// authenticated member, while WEDDING/ENGAGEMENT/BIRTHDAY events only
// resolve for the host, an invited guest, or an admin (row just won't be
// found for anyone else). The attendees array is similarly scoped by RLS:
// the host sees the full guest list, a non-host only sees their own row.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: event, error } = await supabase
    .from("events")
    .select(
      "id, hostId, title, description, location, isVirtual, startAt, endAt, capacity, isCancelled, eventType, connectionId, celebrantUserId"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!event) return NextResponse.json({ error: "Event not found, or you don't have access to it" }, { status: 404 });

  const { data: attendees } = await supabase
    .from("event_attendees")
    .select("userId, rsvpAt, attended, invitedByUserId")
    .eq("eventId", id);

  return NextResponse.json({
    event: { ...event, isHost: event.hostId === user.id },
    attendees: attendees ?? [],
    iAmGoing: (attendees ?? []).some((a: any) => a.userId === user.id),
  });
}

// Edit own event, or admin action (e.g. cancel any event).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    title?: string;
    description?: string;
    location?: string;
    startAt?: string;
    endAt?: string;
    capacity?: number;
    isCancelled?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.description !== undefined) update.description = body.description;
  if (body.location !== undefined) update.location = body.location;
  if (body.startAt !== undefined) update.startAt = body.startAt;
  if (body.endAt !== undefined) update.endAt = body.endAt;
  if (body.capacity !== undefined) update.capacity = body.capacity;
  if (body.isCancelled !== undefined) update.isCancelled = body.isCancelled;

  const { data, error } = await supabase.from("events").update(update).eq("id", id).select().single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json({ error: "Not authorized to make this change" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
