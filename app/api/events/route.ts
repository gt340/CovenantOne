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

export async function GET() {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: events, error } = await supabase
    .from("events")
    .select("id, hostId, title, description, location, isVirtual, startAt, endAt, capacity, isCancelled")
    .eq("isCancelled", false)
    .order("startAt", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const eventIds = (events ?? []).map((e: any) => e.id);
  const { data: attendees } = eventIds.length
    ? await supabase.from("event_attendees").select("eventId, userId").in("eventId", eventIds)
    : { data: [] as any[] };

  const rsvpCount = new Map<string, number>();
  (attendees ?? []).forEach((a: any) => rsvpCount.set(a.eventId, (rsvpCount.get(a.eventId) ?? 0) + 1));
  const myRsvp = new Set((attendees ?? []).filter((a: any) => a.userId === user.id).map((a: any) => a.eventId));

  return NextResponse.json({
    events: (events ?? []).map((e: any) => ({
      ...e,
      rsvpCount: rsvpCount.get(e.id) ?? 0,
      iAmGoing: myRsvp.has(e.id),
    })),
  });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    title?: string;
    description?: string;
    location?: string;
    isVirtual?: boolean;
    startAt?: string;
    endAt?: string;
    capacity?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.title?.trim() || !body.startAt || !body.endAt) {
    return NextResponse.json({ error: "title, startAt and endAt are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("events")
    .insert({
      hostId: user.id,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      location: body.location?.trim() || null,
      isVirtual: body.isVirtual ?? false,
      startAt: body.startAt,
      endAt: body.endAt,
      capacity: body.capacity ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
