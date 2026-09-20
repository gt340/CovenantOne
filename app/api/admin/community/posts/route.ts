import { NextResponse } from "next/server";
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

export async function GET() {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Relies on the community_posts_select_moderator RLS policy to see removed rows too —
  // a plain member's session would just get isRemoved=false rows back here.
  const { data: posts, error } = await supabase
    .from("community_posts")
    .select("id, authorId, title, body, category, isFeatured, isRemoved, createdAt")
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const authorIds = [...new Set((posts ?? []).map((p: any) => p.authorId))];
  const { data: profiles } = authorIds.length
    ? await supabase.from("member_profiles").select("userId, displayName").in("userId", authorIds)
    : { data: [] as any[] };
  const nameByAuthor = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));

  return NextResponse.json({
    posts: (posts ?? []).map((p: any) => ({ ...p, authorName: nameByAuthor.get(p.authorId) ?? "Member" })),
  });
}
