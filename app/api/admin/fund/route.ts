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

// Admin review queue: every campaign regardless of status (RLS already lets moderators see all),
// plus reports and pending disbursement requests, so the whole fund workflow is reviewable in one place.
export async function GET() {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [{ data: campaigns }, { data: reports }, { data: disbursements }] = await Promise.all([
    supabase
      .from("fundraising_campaigns")
      .select("id, organizerId, title, category, goalAmountCents, raisedAmountCents, status, verificationStatus, deadline, createdAt")
      .order("createdAt", { ascending: false }),
    supabase
      .from("reports")
      .select("id, reporterId, reportedUserId, category, description, relatedContentId, status, createdAt")
      .eq("relatedContentType", "FUNDRAISING_CAMPAIGN")
      .order("createdAt", { ascending: false }),
    supabase
      .from("fund_disbursements")
      .select("id, campaignId, amountCents, recipientDescription, status, requestedByUserId, createdAt")
      .eq("status", "PENDING")
      .order("createdAt", { ascending: false }),
  ]);

  const organizerIds = [...new Set((campaigns ?? []).map((c: any) => c.organizerId))];
  const { data: profiles } = organizerIds.length
    ? await supabase.from("member_profiles").select("userId, displayName").in("userId", organizerIds)
    : { data: [] as any[] };
  const nameByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));

  const campaignById = new Map((campaigns ?? []).map((c: any) => [c.id, c]));

  return NextResponse.json({
    campaigns: (campaigns ?? []).map((c: any) => ({ ...c, organizerName: nameByUser.get(c.organizerId) ?? "Member" })),
    reports: (reports ?? []).map((r: any) => ({ ...r, campaignTitle: campaignById.get(r.relatedContentId)?.title ?? "Campaign" })),
    disbursements: (disbursements ?? []).map((d: any) => ({ ...d, campaignTitle: campaignById.get(d.campaignId)?.title ?? "Campaign" })),
  });
}
