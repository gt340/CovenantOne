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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { category?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.category || !body.description?.trim()) {
    return NextResponse.json({ error: "category and description are required" }, { status: 400 });
  }

  const { data: post } = await supabase.from("community_posts").select("authorId").eq("id", id).maybeSingle();
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("reports")
    .insert({
      reporterId: user.id,
      reportedUserId: post.authorId,
      category: body.category,
      description: body.description.trim(),
      relatedContentType: "COMMUNITY_POST",
      relatedContentId: id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
                                                              }
