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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> }
) {
  const { invitationId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { action?: "revoke" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.action !== "revoke") {
    return NextResponse.json({ error: "action must be 'revoke'" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("family_mentor_invitations")
    .update({ status: "REVOKED" })
    .eq("id", invitationId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Invitation not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
