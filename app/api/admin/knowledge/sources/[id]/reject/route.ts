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

// UNDER_REVIEW -> REJECTED. Requires a reason (accountability for the
// decision, visible in source history).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.reason?.trim()) return NextResponse.json({ error: "reason is required" }, { status: 400 });

  const admin = getAdminClient();
  const { data: existing } = await admin.from("knowledge_sources").select('"approvalStatus"').eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.approvalStatus !== "UNDER_REVIEW") {
    return NextResponse.json({ error: `Cannot reject a source in ${existing.approvalStatus} status — only UNDER_REVIEW can be rejected` }, { status: 409 });
  }

  const { data, error } = await admin
    .from("knowledge_sources")
    .update({ approvalStatus: "REJECTED", rejectionReason: body.reason.trim() })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_logs").insert({
    actorUserId: auth.user.id, action: "KNOWLEDGE_SOURCE_REJECTED", targetType: "knowledge_sources", targetId: id,
    metadata: { reason: body.reason.trim() },
  });
  return NextResponse.json({ source: data });
}
