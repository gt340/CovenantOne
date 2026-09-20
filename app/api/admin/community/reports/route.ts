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

  const { data: reports, error } = await supabase
    .from("reports")
    .select("id, reporterId, reportedUserId, category, description, relatedContentType, relatedContentId, status, createdAt")
    .in("relatedContentType", ["COMMUNITY_POST", "COMMENT"])
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const postIds = (reports ?? []).filter((r: any) => r.relatedContentType === "COMMUNITY_POST").map((r: any) => r.relatedContentId);
  const commentIds = (reports ?? []).filter((r: any) => r.relatedContentType === "COMMENT").map((r: any) => r.relatedContentId);
  const userIds = [...new Set((reports ?? []).flatMap((r: any) => [r.reporterId, r.reportedUserId]))];

  const [{ data: posts }, { data: comments }, { data: profiles }] = await Promise.all([
    postIds.length ? supabase.from("community_posts").select("id, title, body, isRemoved").in("id", postIds) : Promise.resolve({ data: [] as any[] }),
    commentIds.length ? supabase.from("comments").select("id, body, isRemoved").in("id", commentIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length ? supabase.from("member_profiles").select("userId, displayName").in("userId", userIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const postById = new Map((posts ?? []).map((p: any) => [p.id, p]));
  const commentById = new Map((comments ?? []).map((c: any) => [c.id, c]));
  const nameByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));

  const result = (reports ?? []).map((r: any) => ({
    ...r,
    reporterName: nameByUser.get(r.reporterId) ?? "Member",
    reportedUserName: nameByUser.get(r.reportedUserId) ?? "Member",
    content:
      r.relatedContentType === "COMMUNITY_POST"
        ? postById.get(r.relatedContentId)
        : commentById.get(r.relatedContentId),
  }));

  return NextResponse.json({ reports: result });
}
