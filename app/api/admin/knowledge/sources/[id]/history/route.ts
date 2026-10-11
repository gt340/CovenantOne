import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

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

// Source history: every version in the lineage (no raw content) plus the
// audit trail for all of those versions. Read-only.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const admin = getAdminClient();
  const { data: source } = await admin.from("knowledge_sources").select('"lineageId"').eq("id", id).maybeSingle();
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: versions, error: vErr } = await admin
    .from("knowledge_sources")
    .select('id, version, "approvalStatus", "licenseStatus", "isCurrentProduction", "supersedesId", "rejectionReason", "reviewedByUserId", "reviewedAt", "archivedAt", "createdAt", "updatedAt"')
    .eq("lineageId", source.lineageId)
    .order("version", { ascending: false });
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 400 });

  const ids = (versions ?? []).map((v: { id: string }) => v.id);
  const { data: audit, error: aErr } = await admin
    .from("audit_logs")
    .select("*")
    .eq("targetType", "knowledge_sources")
    .in("targetId", ids)
    .order("createdAt", { ascending: false })
    .limit(200);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 400 });

  return NextResponse.json({ versions, audit });
}
