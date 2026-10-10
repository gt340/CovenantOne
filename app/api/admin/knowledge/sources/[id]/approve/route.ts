import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const BLOCKED_FOR_APPROVAL = ["LICENSE_REQUIRES_REVIEW", "LICENSE_UNKNOWN", "RESTRICTED"];

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireAdmin() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (!profile || !ADMIN_ROLES.includes(profile.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

// UNDER_REVIEW -> APPROVED (Phase 18 §5/§18). This is the ONLY route that
// can make a source eligible for production retrieval — the DB trigger
// (trg_knowledge_source_approval) atomically flips isCurrentProduction here
// and retires any prior production version of the same lineage.
//
// Licensing gate: a source cannot be approved while its license status is
// still unresolved or restricted (§18 — "do not allow unknown/restricted
// material into production simply because an administrator uploaded it").
// Resolving it is a PATCH to the source first; this route just enforces it.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const admin = getAdminClient();
  const { data: existing } = await admin.from("knowledge_sources").select('"approvalStatus", "licenseStatus"').eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.approvalStatus !== "UNDER_REVIEW") {
    return NextResponse.json({ error: `Cannot approve a source in ${existing.approvalStatus} status — only UNDER_REVIEW can be approved` }, { status: 409 });
  }
  if (BLOCKED_FOR_APPROVAL.includes(existing.licenseStatus)) {
    return NextResponse.json(
      { error: `Cannot approve: licenseStatus is ${existing.licenseStatus}. Resolve licensing (PATCH the source with a verified licenseStatus) before approving.` },
      { status: 409 }
    );
  }

  const { data, error } = await admin.from("knowledge_sources").update({ approvalStatus: "APPROVED" }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_logs").insert({
    actorUserId: auth.user.id, action: "KNOWLEDGE_SOURCE_APPROVED", targetType: "knowledge_sources", targetId: id,
    metadata: { version: data.version, lineageId: data.lineageId },
  });
  return NextResponse.json({ source: data });
}
