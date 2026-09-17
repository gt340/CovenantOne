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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase.from("guidance_articles").select("*").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "Article not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { title?: string; category?: string; summary?: string; body?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.category !== undefined) update.category = body.category;
  if (body.summary !== undefined) update.summary = body.summary?.trim() || null;
  if (body.body !== undefined) update.body = body.body.trim();
  if (body.status !== undefined) {
    update.status = body.status;
    if (body.status === "PUBLISHED") update.publishedAt = new Date().toISOString();
  }

  const { data, error } = await supabase.from("guidance_articles").update(update).eq("id", id).select().single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Article not found or you don't have permission" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await supabase.from("guidance_articles").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
