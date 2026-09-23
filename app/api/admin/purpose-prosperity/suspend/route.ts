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

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { userId?: string; days?: number; lift?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const update = body.lift
    ? { status: "ACTIVE", suspendedUntil: null }
    : { status: "SUSPENDED", suspendedUntil: new Date(Date.now() + (body.days ?? 7) * 24 * 60 * 60 * 1000).toISOString() };

  const { data, error } = await supabase
    .from("users")
    .update(update)
    .eq("id", body.userId)
    .select("id, status, suspendedUntil")
    .single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json({ error: "Not authorized to make this change" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
