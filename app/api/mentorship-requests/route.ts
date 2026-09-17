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

export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const as = searchParams.get("as"); // "mentee" (default) | "mentor"

  let requests;
  if (as === "mentor") {
    const { data: mentorRow } = await supabase.from("mentors").select("id").eq("userId", user.id).maybeSingle();
    if (!mentorRow) return NextResponse.json({ requests: [] });
    const { data, error } = await supabase
      .from("mentorship_requests")
      .select("id, menteeId, mentorId, status, message, createdAt")
      .eq("mentorId", mentorRow.id)
      .order("createdAt", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    requests = data;
  } else {
    const { data, error } = await supabase
      .from("mentorship_requests")
      .select("id, menteeId, mentorId, status, message, createdAt")
      .eq("menteeId", user.id)
      .order("createdAt", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    requests = data;
  }

  return NextResponse.json({ requests: requests ?? [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { mentorId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.mentorId) {
    return NextResponse.json({ error: "mentorId is required" }, { status: 400 });
  }

  const { data: mentor } = await supabase
    .from("mentors")
    .select("id, userId, isActive, capacity")
    .eq("id", body.mentorId)
    .single();
  if (!mentor || !mentor.isActive) {
    return NextResponse.json({ error: "Mentor not found or not currently active" }, { status: 404 });
  }
  if (mentor.userId === user.id) {
    return NextResponse.json({ error: "You cannot request yourself as a mentor" }, { status: 400 });
  }

  const { count } = await supabase
    .from("mentorship_requests")
    .select("id", { count: "exact", head: true })
    .eq("mentorId", mentor.id)
    .eq("status", "ACCEPTED");
  if ((count ?? 0) >= mentor.capacity) {
    return NextResponse.json({ error: "This mentor is currently at capacity" }, { status: 409 });
  }

  const { data: existing } = await supabase
    .from("mentorship_requests")
    .select("id")
    .eq("mentorId", mentor.id)
    .eq("menteeId", user.id)
    .in("status", ["PENDING", "ACCEPTED"])
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "You already have an active or pending request with this mentor" }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("mentorship_requests")
    .insert({ menteeId: user.id, mentorId: mentor.id, message: body.message?.trim() || null, status: "PENDING" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
