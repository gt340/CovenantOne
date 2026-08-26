import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";

export async function GET() {
  const { user, error } = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: error ?? "Not signed in." }, { status: 401 });
  }

  const supabase = createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  const { data: phoneRow } = await supabase
    .from("phone_verifications")
    .select("status")
    .eq("userId", user.id)
    .maybeSingle();

  const { data: profileRow } = await supabase
    .from("member_profiles")
    .select("id, isDiscoverable")
    .eq("userId", user.id)
    .maybeSingle();

  const { data: faithRow } = await supabase
    .from("faith_profiles")
    .select("id")
    .eq("userId", user.id)
    .maybeSingle();

  const { data: intentionRow } = await supabase
    .from("marriage_intentions")
    .select("id")
    .eq("userId", user.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    status: user.status,
    role: user.role,
    emailVerified: Boolean(authUser?.email_confirmed_at),
    phoneVerified: phoneRow?.status === "VERIFIED",
    hasProfile: Boolean(profileRow),
    hasFaithProfile: Boolean(faithRow),
    hasMarriageIntention: Boolean(intentionRow),
    isDiscoverable: Boolean(profileRow?.isDiscoverable),
  });
}
