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

  const { data: campaign, error } = await supabase
    .from("fundraising_campaigns")
    .select("id, organizerId, title, description, category, goalAmountCents, raisedAmountCents, status, deadline, verificationStatus, reviewNotes, beneficiaryName, beneficiaryRelationship, createdAt")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const { data: profile } = await supabase.from("member_profiles").select("displayName").eq("userId", campaign.organizerId).maybeSingle();

  // Only COMPLETED (successful) donations count as public donation history — a PENDING donation is not yet
  // real money and must never be shown as if it were.
  const { data: donations } = await supabase
    .from("donations")
    .select("id, donorId, amountCents, isAnonymousDisplay, createdAt")
    .eq("campaignId", id)
    .eq("status", "COMPLETED")
    .order("createdAt", { ascending: false });

  const donorIds = [...new Set((donations ?? []).filter((d: any) => !d.isAnonymousDisplay).map((d: any) => d.donorId))];
  const { data: donorProfiles } = donorIds.length
    ? await supabase.from("member_profiles").select("userId, displayName").in("userId", donorIds)
    : { data: [] as any[] };
  const nameByDonor = new Map((donorProfiles ?? []).map((p: any) => [p.userId, p.displayName]));

  const { data: evidence } = await supabase
    .from("campaign_evidence")
    .select("id, description, storageKey, createdAt")
    .eq("campaignId", id);

  return NextResponse.json({
    ...campaign,
    organizerName: profile?.displayName ?? "Member",
    donations: (donations ?? []).map((d: any) => ({
      id: d.id,
      amountCents: d.amountCents,
      createdAt: d.createdAt,
      donorName: d.isAnonymousDisplay ? "Anonymous" : nameByDonor.get(d.donorId) ?? "Member",
    })),
    evidence: evidence ?? [],
  });
}

// Organizer edits (only while SUBMITTED — enforced by DB trigger) or moderator review action.
// Moderators drive the workflow one step at a time; the trigger enforces the exact allowed sequence.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    title?: string;
    description?: string;
    status?: string;
    verificationStatus?: string;
    reviewNotes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.description !== undefined) update.description = body.description.trim();
  if (body.status !== undefined) update.status = body.status;
  if (body.verificationStatus !== undefined) update.verificationStatus = body.verificationStatus;
  if (body.reviewNotes !== undefined) update.reviewNotes = body.reviewNotes.trim();
  if (body.status !== undefined || body.verificationStatus !== undefined || body.reviewNotes !== undefined) {
    update.reviewedByUserId = user.id;
    update.reviewedAt = new Date().toISOString();
  }

  const { data, error } = await supabase.from("fundraising_campaigns").update(update).eq("id", id).select().single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json({ error: "Not authorized to make this change" }, { status: 403 });
    }
    // Our DB trigger raises plain exceptions for invalid workflow transitions or edit-after-submission —
    // surface that message directly since it's already written for a human to read.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
