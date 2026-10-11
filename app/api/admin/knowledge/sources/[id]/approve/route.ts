import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { evaluateApproval } from "@/lib/aiPastor/knowledgeGovernance";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  return { user, role: (profile?.role ?? null) as string | null };
}

// UNDER_REVIEW -> APPROVED (Phase 18 §5/§18). This is the ONLY route that
// can make a source eligible for production retrieval — the DB trigger
// (trg_knowledge_source_approval) atomically flips isCurrentProduction here
// and retires any prior production version of the same lineage.
//
// Two-person rule: the administrator who authored this version cannot approve
// it. The decision lives in evaluateApproval() (unit-tested) AND is enforced
// again by the database trigger, which requires reviewedByUserId to be set in
// the same UPDATE, to differ from the uploader, and to be an ADMIN/SUPER_ADMIN.
// Licensing gate: unresolved/restricted licences cannot be approved (§18).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  // Non-admins are rejected before any source detail is read or revealed.
  const preCheck = evaluateApproval({
    actorId: auth.user.id, actorRole: auth.role, uploaderId: "", approvalStatus: "UNDER_REVIEW", licenseStatus: "LICENSE_VERIFIED",
  });
  if (!preCheck.allowed && preCheck.code === "FORBIDDEN") return NextResponse.json({ error: preCheck.message }, { status: preCheck.status });

  const admin = getAdminClient();
  const { data: existing } = await admin
    .from("knowledge_sources")
    .select('"approvalStatus", "licenseStatus", "uploaderUserId", version, "lineageId"')
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const decision = evaluateApproval({
    actorId: auth.user.id, actorRole: auth.role, uploaderId: existing.uploaderUserId,
    approvalStatus: existing.approvalStatus, licenseStatus: existing.licenseStatus,
  });
  if (!decision.allowed) {
    if (decision.code === "SELF_APPROVAL_FORBIDDEN") {
      await admin.from("audit_logs").insert({
        actorUserId: auth.user.id, action: "KNOWLEDGE_SOURCE_APPROVAL_DENIED", targetType: "knowledge_sources", targetId: id,
        metadata: { reason: "SELF_APPROVAL_FORBIDDEN", version: existing.version },
      });
    }
    return NextResponse.json({ error: decision.message, code: decision.code }, { status: decision.status });
  }

  const { data, error } = await admin
    .from("knowledge_sources")
    .update({ approvalStatus: "APPROVED", reviewedByUserId: auth.user.id })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    // The database enforces the same rule independently of this route.
    const code = /SELF_APPROVAL_FORBIDDEN/.test(error.message) ? 403 : /REVIEWER_/.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status: code });
  }

  await admin.from("audit_logs").insert({
    actorUserId: auth.user.id, action: "KNOWLEDGE_SOURCE_APPROVED", targetType: "knowledge_sources", targetId: id,
    metadata: {
      version: data.version, lineageId: data.lineageId,
      licenseStatus: existing.licenseStatus, authorUserId: existing.uploaderUserId, reviewerUserId: auth.user.id,
    },
  });
  return NextResponse.json({ source: data });
}
