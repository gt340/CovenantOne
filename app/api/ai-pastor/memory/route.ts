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

// Phase 16 §8: four narrow categories only — USER_PREFERENCES,
// BIBLE_STUDY_PROGRESS, LEARNING_HISTORY, CONVERSATION_CONTEXT. Nothing
// else is a valid category, which is itself part of the control: this
// table structurally can't hold an arbitrary sensitive fact, only a
// key/value pair filed under one of these four buckets.
export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const category = request.nextUrl.searchParams.get("category");
  let query = supabase.from("ai_pastor_memory").select("id, category, key, value, updatedAt").order("updatedAt", { ascending: false });
  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memory: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { category?: string; key?: string; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const validCategories = ["USER_PREFERENCES", "BIBLE_STUDY_PROGRESS", "LEARNING_HISTORY", "CONVERSATION_CONTEXT"];
  if (!body.category || !validCategories.includes(body.category) || !body.key?.trim()) {
    return NextResponse.json({ error: `category must be one of ${validCategories.join(", ")}, and key is required` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ai_pastor_memory")
    .upsert({ userId: user.id, category: body.category, key: body.key.trim(), value: body.value ?? null }, { onConflict: "userId,category,key" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

// Explicit forget capability (Phase 16 §8: "Members should be able to
// request that information be forgotten"). ?id= for one item, or
// ?category= to clear a whole bucket.
export async function DELETE(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  const category = request.nextUrl.searchParams.get("category");
  if (!id && !category) return NextResponse.json({ error: "id or category is required" }, { status: 400 });

  let query = supabase.from("ai_pastor_memory").delete();
  query = id ? query.eq("id", id) : query.eq("category", category!);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deleted: true });
}
