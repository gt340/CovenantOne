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

const STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { status?: string; summary?: string; scheduledAt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.status && !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(", ")}` }, { status: 400 });
  }

  const update: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (body.status) update.status = body.status;
  if (body.summary !== undefined) update.summary = body.summary?.trim() || null;
  if (body.scheduledAt) update.scheduledAt = body.scheduledAt;

  // RLS (mentor_sessions_update_mentor) restricts this to the mentor who
  // owns the session — a mentee attempting this affects zero rows.
  const { data, error } = await supabase
    .from("mentor_sessions")
    .update(update)
    .eq("id", sessionId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Session not found or you don't have permission" }, { status: 404 });
  }

  return NextResponse.json(data);
}
