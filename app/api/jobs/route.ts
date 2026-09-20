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
  const q = searchParams.get("q");

  let query = supabase
    .from("jobs")
    .select("id, posterId, businessId, title, company, description, location, isRemote, category, isActive, isRemoved, createdAt")
    .order("createdAt", { ascending: false });

  if (mine) {
    query = query.eq("posterId", user.id);
  } else {
    query = query.eq("isActive", true).eq("isRemoved", false);
  }
  if (category) query = query.eq("category", category);
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,company.ilike.%${q}%`);

  const { data: jobs, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const businessIds = [...new Set((jobs ?? []).map((j: any) => j.businessId).filter(Boolean))];
  const { data: businesses } = businessIds.length
    ? await supabase.from("business_profiles").select("id, businessName").in("id", businessIds)
    : { data: [] as any[] };
  const businessById = new Map((businesses ?? []).map((b: any) => [b.id, b]));

  return NextResponse.json({
    jobs: (jobs ?? []).map((j: any) => ({
      ...j,
      employerName: businessById.get(j.businessId)?.businessName ?? j.company ?? "Independent",
    })),
  });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    title?: string;
    company?: string;
    description?: string;
    location?: string;
    isRemote?: boolean;
    category?: string;
    businessId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.title?.trim() || !body.description?.trim()) {
    return NextResponse.json({ error: "title and description are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      posterId: user.id,
      title: body.title.trim(),
      company: body.company?.trim() || null,
      description: body.description.trim(),
      location: body.location?.trim() || null,
      isRemote: body.isRemote ?? false,
      category: body.category || null,
      businessId: body.businessId || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
    }
