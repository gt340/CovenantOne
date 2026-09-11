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

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { reportId?: string; priority?: string; assignToSelf?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.reportId) {
    return NextResponse.json({ error: "reportId is required" }, { status: 400 });
  }

  // RLS (moderation_cases_insert_moderator_tier) enforces that only
  // MODERATOR tier and above can create a case at all — a plain MEMBER
  // insert attempt is rejected by the database itself, not just this check.
  const { data, error } = await supabase
    .from("moderation_cases")
    .insert({
      reportId: body.reportId,
      assignedModeratorId: body.assignToSelf ? user.id : null,
      status: "OPEN",
      priority: body.priority ?? "NORMAL",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("reports").update({ status: "UNDER_REVIEW" }).eq("id", body.reportId);

  return NextResponse.json(data, { status: 201 });
}
