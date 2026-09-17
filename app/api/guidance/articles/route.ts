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

const CATEGORIES = [
  "PREPARING_FOR_MARRIAGE",
  "CHOOSING_A_SPOUSE",
  "COMMUNICATION",
  "CONFLICT_RESOLUTION",
  "FAITH_AND_MARRIAGE",
  "FAMILY",
  "FINANCIAL_PLANNING",
  "BUSINESS_AND_MARRIAGE",
  "EMOTIONAL_MATURITY",
  "RESPONSIBLE_COURTSHIP",
  "MARRIAGE_PREPARATION",
  "LIFE_AFTER_MARRIAGE",
];

export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const mine = searchParams.get("mine") === "true";

  let query = supabase
    .from("guidance_articles")
    .select("id, title, category, summary, status, authorUserId, createdAt, publishedAt")
    .order("publishedAt", { ascending: false, nullsFirst: false });

  if (!mine) {
    query = query.eq("status", "PUBLISHED");
  }
  if (category) {
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `category must be one of: ${CATEGORIES.join(", ")}` }, { status: 400 });
    }
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ articles: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { title?: string; category?: string; summary?: string; body?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!body.category || !CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `category must be one of: ${CATEGORIES.join(", ")}` }, { status: 400 });
  }
  if (!body.body?.trim()) return NextResponse.json({ error: "body is required" }, { status: 400 });

  const status = body.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

  const { data, error } = await supabase
    .from("guidance_articles")
    .insert({
      title: body.title.trim(),
      category: body.category,
      summary: body.summary?.trim() || null,
      body: body.body.trim(),
      authorUserId: user.id,
      status,
      publishedAt: status === "PUBLISHED" ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
