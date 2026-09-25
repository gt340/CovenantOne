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

// Organizer requests a payout once their campaign has COMPLETED (RLS + trigger allow the insert;
// the actual campaign-status gate is enforced at the app level here too for a clearer error message).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("fund_disbursements")
    .select("id, campaignId, amountCents, recipientDescription, status, requestedByUserId, approvedByUserId, disbursedAt, createdAt")
    .eq("campaignId", id)
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ disbursements: data ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { amount?: number; recipientDescription?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.amount || body.amount <= 0 || !body.recipientDescription?.trim()) {
    return NextResponse.json({ error: "amount and recipientDescription are required" }, { status: 400 });
  }

  const { data: campaign } = await supabase.from("fundraising_campaigns").select("status, raisedAmountCents").eq("id", id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status !== "COMPLETED") {
    return NextResponse.json({ error: "A payout can only be requested once the campaign is COMPLETED" }, { status: 400 });
  }
  const amountCents = Math.round(body.amount * 100);
  if (amountCents > campaign.raisedAmountCents) {
    return NextResponse.json({ error: "Requested amount exceeds the amount actually raised" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("fund_disbursements")
    .insert({
      campaignId: id,
      requestedByUserId: user.id,
      amountCents,
      recipientDescription: body.recipientDescription.trim(),
      status: "PENDING",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
