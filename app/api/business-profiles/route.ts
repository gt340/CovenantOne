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
  const category = searchParams.get("category");
  const partnershipOnly = searchParams.get("partnership") === "true";

  let query = supabase
    .from("business_profiles")
    .select("id, ownerId, businessName, categorySlug, description, website, isPublic, isRemoved, openToPartnership, partnershipNotes, createdAt");

  if (mine) {
    query = query.eq("ownerId", user.id);
  } else {
    query = query.eq("isPublic", true).eq("isRemoved", false);
  }
  if (category) query = query.eq("categorySlug", category);
  if (partnershipOnly) query = query.eq("openToPartnership", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ businesses: data ?? [] });
}

// One profile per user — upsert on ownerId.
export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    businessName?: string;
    categorySlug?: string;
    description?: string;
    website?: string;
    isPublic?: boolean;
    openToPartnership?: boolean;
    partnershipNotes?: string;
  };
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
        categorySlug: body.categorySlug || null,
        description: body.description?.trim() || null,
        website: body.website?.trim() || null,
        isPublic: body.isPublic ?? true,
        openToPartnership: body.openToPartnership ?? false,
        partnershipNotes: body.partnershipNotes?.trim() || null,
      },
      { onConflict: "ownerId" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
