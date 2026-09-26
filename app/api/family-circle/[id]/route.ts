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

// Either participant can update an invitation's status — this records what
// actually happened with the family member/mentor offline (they accepted,
// declined, or the couple revoked it), since the invitee isn't a platform
// account that logs in to respond itself.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    status?: "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED";
    accessScope?: "VIEW_STAGE_ONLY" | "VIEW_STAGE_AND_SUMMARY";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.status && !body.accessScope) {
    return NextResponse.json({ error: "status or accessScope is required" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.status) update.status = body.status;
  if (body.accessScope) update.accessScope = body.accessScope;

  const { data, error } = await supabase
    .from("family_mentor_invitations")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json(
        { error: "Invitation not found, or you're not a participant in its connection" },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
