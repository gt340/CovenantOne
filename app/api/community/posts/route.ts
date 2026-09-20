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
  const category = searchParams.get("category");
  const mine = searchParams.get("mine") === "true";

  let query = supabase
    .from("community_posts")
    .select("id, authorId, title, body, category, visibility, isFeatured, isRemoved, createdAt")
    .eq("isRemoved", false)
    .order("isFeatured", { ascending: false })
    .order("createdAt", { ascending: false });

  if (category) query = query.eq("category", category);
  if (mine) query = query.eq("authorId", user.id);

  const { data: posts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const postIds = (posts ?? []).map((p: any) => p.id);
  const authorIds = [...new Set((posts ?? []).map((p: any) => p.authorId))];

  const [{ data: profiles }, { data: comments }, { data: reactions }] = await Promise.all([
    authorIds.length
      ? supabase.from("member_profiles").select("userId, displayName").in("userId", authorIds)
      : Promise.resolve({ data: [] as any[] }),
    postIds.length
      ? supabase.from("comments").select("postId").eq("isRemoved", false).in("postId", postIds)
      : Promise.resolve({ data: [] as any[] }),
    postIds.length
      ? supabase.from("post_reactions").select("postId").in("postId", postIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const nameByAuthor = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));
  const commentCount = new Map<string, number>();
  (comments ?? []).forEach((c: any) => commentCount.set(c.postId, (commentCount.get(c.postId) ?? 0) + 1));
  const reactionCount = new Map<string, number>();
  (reactions ?? []).forEach((r: any) => reactionCount.set(r.postId, (reactionCount.get(r.postId) ?? 0) + 1));

  const result = (posts ?? []).map((p: any) => ({
    ...p,
    authorName: nameByAuthor.get(p.authorId) ?? "Member",
    commentCount: commentCount.get(p.id) ?? 0,
    reactionCount: reactionCount.get(p.id) ?? 0,
  }));

  return NextResponse.json({ posts: result });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { title?: string; body?: string; category?: string; visibility?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.title?.trim() || !body.body?.trim()) {
    return NextResponse.json({ error: "title and body are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("community_posts")
    .insert({
      authorId: user.id,
      title: body.title.trim(),
      body: body.body.trim(),
      category: body.category ?? null,
      visibility: body.visibility ?? "MEMBERS_ONLY",
    })
    .select()
    .single();

  if (error) {
    // Our DB trigger raises a plain exception (community ban / restricted category) —
    // surface its message directly rather than a generic 500.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
