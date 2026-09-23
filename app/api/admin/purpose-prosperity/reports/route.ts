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
    .in("relatedContentType", ["JOB_LISTING", "BUSINESS_PROFILE"])
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const jobIds = (reports ?? []).filter((r: any) => r.relatedContentType === "JOB_LISTING").map((r: any) => r.relatedContentId);
  const businessIds = (reports ?? []).filter((r: any) => r.relatedContentType === "BUSINESS_PROFILE").map((r: any) => r.relatedContentId);
  const userIds = [...new Set((reports ?? []).flatMap((r: any) => [r.reporterId, r.reportedUserId]))];

  const [{ data: jobs }, { data: businesses }, { data: profiles }] = await Promise.all([
    jobIds.length ? supabase.from("jobs").select("id, title, isRemoved").in("id", jobIds) : Promise.resolve({ data: [] as any[] }),
    businessIds.length ? supabase.from("business_profiles").select("id, businessName, isRemoved").in("id", businessIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length ? supabase.from("member_profiles").select("userId, displayName").in("userId", userIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const jobById = new Map((jobs ?? []).map((j: any) => [j.id, j]));
  const businessById = new Map((businesses ?? []).map((b: any) => [b.id, b]));
  const nameByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));

  return NextResponse.json({
    reports: (reports ?? []).map((r: any) => ({
      ...r,
      reporterName: nameByUser.get(r.reporterId) ?? "Member",
      reportedUserName: nameByUser.get(r.reportedUserId) ?? "Member",
      content: r.relatedContentType === "JOB_LISTING" ? jobById.get(r.relatedContentId) : businessById.get(r.relatedContentId),
    })),
  });
}
