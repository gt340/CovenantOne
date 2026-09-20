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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: post, error } = await supabase
    .from("community_posts")
    .select("id, authorId, title, body, category, visibility, isFeatured, isRemoved, createdAt")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const { data: profile } = await supabase
    .from("member_profiles")
    .select("displayName")
    .eq("userId", post.authorId)
    .maybeSingle();

  const { data: reactions } = await supabase.from("post_reactions").select("userId, type").eq("postId", id);
  const myReaction = (reactions ?? []).find((r: any) => r.userId === user.id)?.type ?? null;

  return NextResponse.json({
    ...post,
    authorName: profile?.displayName ?? "Member",
    reactionCounts: (reactions ?? []).reduce((acc: Record<string, number>, r: any) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1;
      return acc;
    }, {}),
    myReaction,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { title?: string; body?: string; category?: string; isRemoved?: boolean; isFeatured?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.body !== undefined) update.body = body.body.trim();
  if (body.category !== undefined) update.category = body.category;
  if (body.isRemoved !== undefined) update.isRemoved = body.isRemoved;
  if (body.isFeatured !== undefined) update.isFeatured = body.isFeatured;

  const { data, error } = await supabase
    .from("community_posts")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json({ error: "Not authorized to make this change" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
    }
