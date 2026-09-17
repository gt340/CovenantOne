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
  const { id: mentorshipRequestId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // RLS (mentor_sessions_select_mentor / _select_mentee) already scopes
  // this correctly — a third party querying this mentorshipRequestId
  // just gets zero rows.
  const { data, error } = await supabase
    .from("mentor_sessions")
    .select("id, mentorshipRequestId, mentorId, menteeId, scheduledAt, durationMinutes, status, summary, createdAt")
    .eq("mentorshipRequestId", mentorshipRequestId)
    .order("scheduledAt", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: mentorshipRequestId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { scheduledAt?: string; durationMinutes?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.scheduledAt) {
    return NextResponse.json({ error: "scheduledAt is required (ISO datetime)" }, { status: 400 });
  }

  const { data: reqRow, error: reqError } = await supabase
    .from("mentorship_requests")
    .select("id, menteeId, mentorId, status")
    .eq("id", mentorshipRequestId)
    .single();
  if (reqError || !reqRow) {
    return NextResponse.json({ error: "Mentorship request not found" }, { status: 404 });
  }
  if (reqRow.status !== "ACCEPTED") {
    return NextResponse.json({ error: "Sessions can only be scheduled for an accepted mentorship" }, { status: 409 });
  }

  const { data: mentorRow } = await supabase.from("mentors").select("id, userId").eq("id", reqRow.mentorId).single();
  if (!mentorRow || mentorRow.userId !== user.id) {
    return NextResponse.json({ error: "Only the mentor can schedule a session" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("mentor_sessions")
    .insert({
      mentorshipRequestId,
      mentorId: reqRow.mentorId,
      menteeId: reqRow.menteeId,
      scheduledAt: body.scheduledAt,
      durationMinutes: body.durationMinutes ?? 45,
      status: "SCHEDULED",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
