import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/src/lib/paymentProvider";

// Paystack webhook endpoint. This is the ONLY place a donation may move from PENDING to
// COMPLETED/FAILED — never a direct client request. Uses the service role key (server-to-server,
// no user session) specifically because this must run regardless of who the donor is, but every
// signature is verified first, and the DB trigger (enforce_donation_rules) is the actual source of
// truth for what's allowed to change — this route cannot bypass it even with the service role key.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid or missing signature" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    // No service role key configured means this environment cannot safely process webhooks yet —
    // fail closed rather than silently dropping a real payment confirmation.
    return NextResponse.json({ error: "Webhook processing not configured" }, { status: 503 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey);

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const reference = event?.data?.reference;
  if (!reference) return NextResponse.json({ error: "Missing reference" }, { status: 400 });

  const newStatus = event.event === "charge.success" ? "COMPLETED" : event.event === "charge.failed" ? "FAILED" : null;
  if (!newStatus) return NextResponse.json({ ok: true }); // event type we don't act on — acknowledge and ignore

  const { error } = await supabase
    .from("donations")
    .update({ status: newStatus, verifiedAt: new Date().toISOString() })
    .eq("paymentProviderRef", reference)
    .eq("status", "PENDING");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
