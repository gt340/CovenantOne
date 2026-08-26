import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";

// DECISION: account deletion here is a STATUS TRANSITION (-> DELETED,
// deletedAt set, session revoked), not an immediate hard delete of the
// auth.users row. Rationale:
//   - Matches the account status lifecycle Phase 2 asked for (DELETED is one
//     of the listed statuses, implying it's a state the account can be IN,
//     not just an event).
//   - Preserves the option of a grace-period/undo window and of honoring
//     data-retention obligations, without deciding those policies here.
//   - A hard delete of auth.users cascades (ON DELETE CASCADE) through every
//     table in the schema instantly and irreversibly — appropriate for a
//     separate, deliberate purge job, not a single user-facing button.
// The admin client is used only for the one piece that genuinely needs
// elevated privilege: revoking every existing session for this user so the
// deletion can't be casually undone by continuing to use an open tab.
export async function POST() {
  const { user, error } = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: error ?? "Not signed in." }, { status: 401 });
  }

  const supabase = createClient();

  const { error: updateError } = await supabase
    .from("users")
    .update({ status: "DELETED", deletedAt: new Date().toISOString() })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  // Also pull the member profile out of discoverability immediately, rather
  // than waiting on a background job — the RLS policy already gates on
  // isDiscoverable, this just makes the intent explicit at the point of
  // deletion instead of relying only on account status checks elsewhere.
  await supabase.from("member_profiles").update({ isDiscoverable: false }).eq("userId", user.id);

  try {
    const admin = createAdminClient();
    await admin.auth.admin.signOut(user.id, "global");
  } catch (adminError) {
    // The status transition above already succeeded and is the part that
    // matters for account state — a failure to revoke sessions is logged,
    // not fatal to the request, but should be monitored in production.
    console.error("Failed to revoke sessions on account deletion:", adminError);
  }

  await supabase.auth.signOut();

  return NextResponse.json({ ok: true });
}
