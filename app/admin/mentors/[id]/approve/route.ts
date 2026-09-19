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

// Approve (or re-deactivate) a mentor profile. Admin-only via the
// mentors_admin RLS policy (private.is_admin_tier()). IMPORTANT: we
// .select().single() after the update and treat an empty result as a 403 —
// per this project's recurring RLS-gap bug pattern, an RLS-blocked UPDATE
// returns 0 rows silently rather than erroring, so skipping this check
// would make a non-admin's approve attempt look like it succeeded.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { isActive?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const isActive = body.isActive ?? true;

  const { data, error } = await supabase
    .from("mentors")
    .update({
      isActive,
      approvedByUserId: isActive ? user.id : null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    // PGRST116 = "no rows returned" from .single() on a 0-row result —
    // this is the RLS-blocked case (not admin), NOT a genuine 404.
    if ((error as any).code === "PGRST116") {
      return NextResponse.json({ error: "Not authorized to approve mentors" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
