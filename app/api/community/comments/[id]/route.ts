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

  const { data: comments, error } = await supabase
    .from("comments")
    .select("id, postId, authorId, parentCommentId, body, isRemoved, createdAt")
    .eq("postId", id)
    .eq("isRemoved", false)
    .order("createdAt", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const authorIds = [...new Set((comments ?? []).map((c: any) => c.authorId))];
  const { data: profiles } = authorIds.length
    ? await supabase.from("member_profiles").select("userId, displayName").in("userId", authorIds)
    : { data: [] as any[] };
  const nameByAuthor = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));

  return NextResponse.json({
    comments: (comments ?? []).map((c: any) => ({ ...c, authorName: nameByAuthor.get(c.authorId) ?? "Member" })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { body?: string; parentCommentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.body?.trim()) return NextResponse.json({ error: "body is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("comments")
    .insert({
      postId: id,
      authorId: user.id,
      parentCommentId: body.parentCommentId ?? null,
      body: body.body.trim(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
