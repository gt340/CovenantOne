import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isPaymentProviderConfigured, isTestMode, initializeTransaction } from "@/lib/paymentProvider";

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

// Starts a donation. If no real payment provider is configured, this returns a clear, honest
// "not connected" response and creates NO donation record at all — a donation row implies a real
// payment attempt happened, and we never want a misleading row sitting in the financial history.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { amount?: number; isAnonymous?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.amount || body.amount <= 0) {
    return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
  }

  if (!isPaymentProviderConfigured()) {
    return NextResponse.json(
      {
        error: "Payments are not yet connected on this platform. This is a sandbox environment — no real payment provider is configured.",
        paymentConnected: false,
      },
      { status: 503 }
    );
  }

  const { data: campaign } = await supabase
    .from("fundraising_campaigns")
    .select("id, status, deadline, title")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status !== "ACTIVE") return NextResponse.json({ error: "This campaign is not currently accepting donations" }, { status: 400 });
  if (new Date(campaign.deadline) < new Date()) return NextResponse.json({ error: "This campaign has passed its deadline" }, { status: 400 });

  const { data: { user: authUser } } = await supabase.auth.getUser();
  const reference = `don_${id}_${Date.now()}`;
  const amountCents = Math.round(body.amount * 100);

  let checkout;
  try {
    checkout = await initializeTransaction({
      amountCents,
      email: authUser?.email ?? "donor@covenantone.app",
      reference,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/fund/${id}?donation=complete`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Payment provider request failed" }, { status: 502 });
  }

  // Record the PENDING donation only after the provider confirms the transaction was actually
  // initialized — its status only ever moves to COMPLETED/FAILED via the verified webhook, never here.
  const { data: donation, error } = await supabase
    .from("donations")
    .insert({
      campaignId: id,
      donorId: user.id,
      amountCents,
      status: "PENDING",
      provider: "PAYSTACK",
      isTestMode: isTestMode(),
      isAnonymousDisplay: body.isAnonymous ?? false,
      paymentProviderRef: checkout.reference,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ donation, checkoutUrl: checkout.authorizationUrl, isTestMode: isTestMode() }, { status: 201 });
}
