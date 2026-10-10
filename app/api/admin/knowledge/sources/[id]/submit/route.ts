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

// DRAFT -> UNDER_REVIEW (Phase 18 §5). Any admin may submit; approval is a
// separate, explicitly logged step below — this route alone can never make
// a source enter production retrieval (the DB trigger only flips
// isCurrentProduction on the APPROVED transition).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const admin = getAdminClient();
  const { data: existing } = await admin.from("knowledge_sources").select('"approvalStatus"').eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.approvalStatus !== "DRAFT") {
    return NextResponse.json({ error: `Cannot submit a source in ${existing.approvalStatus} status — only DRAFT can be submitted for review` }, { status: 409 });
  }

  const { data, error } = await admin.from("knowledge_sources").update({ approvalStatus: "UNDER_REVIEW" }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_logs").insert({ actorUserId: auth.user.id, action: "KNOWLEDGE_SOURCE_SUBMITTED", targetType: "knowledge_sources", targetId: id });
  return NextResponse.json({ source: data });
}
