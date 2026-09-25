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

// Admin approves/pays/rejects a disbursement request. The DB trigger blocks any further change once
// status is PAID, and logs every transition to audit_logs automatically.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 });

  const update: Record<string, unknown> = { status: body.status };
  if (body.status === "APPROVED") update.approvedByUserId = user.id;
  if (body.status === "PAID") update.disbursedAt = new Date().toISOString();

  const { data, error } = await supabase.from("fund_disbursements").update(update).eq("id", id).select().single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json({ error: "Not authorized to make this change" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Once a disbursement is actually PAID out, mark the campaign DISBURSED — the final state in the
  // required workflow. The campaign-status trigger only allows COMPLETED -> DISBURSED, matching this.
  if (body.status === "PAID") {
    await supabase.from("fundraising_campaigns").update({ status: "DISBURSED" }).eq("id", data.campaignId);
  }

  return NextResponse.json(data);
}
