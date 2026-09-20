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

export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mine = searchParams.get("mine") === "true";

  let query = supabase
    .from("business_profiles")
    .select("id, ownerId, businessName, category, description, website, isPublic, createdAt");

  if (mine) query = query.eq("ownerId", user.id);
  else query = query.eq("isPublic", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ businesses: data ?? [] });
}

// One profile per user — upsert on ownerId (unique constraint already exists in the DB).
export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { businessName?: string; category?: string; description?: string; website?: string; isPublic?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.businessName?.trim()) {
    return NextResponse.json({ error: "businessName is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("business_profiles")
    .upsert(
      {
        ownerId: user.id,
        businessName: body.businessName.trim(),
        category: body.category?.trim() || null,
        description: body.description?.trim() || null,
        website: body.website?.trim() || null,
        isPublic: body.isPublic ?? true,
      },
      { onConflict: "ownerId" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
