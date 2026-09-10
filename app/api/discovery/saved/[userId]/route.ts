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

// Uses the caller's own session (not service role) — RLS on
// saved_profiles already restricts rows to userId = auth.uid(),
// so no extra authorization logic is needed here.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { savedProfileUserId } = { savedProfileUserId: (await params).userId };
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.id === savedProfileUserId) {
    return NextResponse.json({ error: "Cannot save your own profile" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("saved_profiles")
    .upsert({ userId: user.id, savedProfileUserId }, { onConflict: "userId,savedProfileUserId" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { savedProfileUserId } = { savedProfileUserId: (await params).userId };
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await supabase
    .from("saved_profiles")
    .delete()
    .eq("userId", user.id)
    .eq("savedProfileUserId", savedProfileUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
