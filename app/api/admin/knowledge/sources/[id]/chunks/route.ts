import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const PREVIEW_CHARS = 400; // admin review never needs full text dumps
const MAX_PAGE_SIZE = 50;

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

// Ingestion status + chunk review for one source version. Read-only.
// Reports honestly what has and has not happened: embeddings are not
// generated in this build, so embeddingStatus is reported as stored, never
// implied to be "indexed".
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));

  const admin = getAdminClient();
  const { data: source } = await admin
    .from("knowledge_sources")
    .select('id, version, title, "approvalStatus", "licenseStatus", "contentCharCount", "isCurrentProduction"')
    .eq("id", id)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: all, error: sErr } = await admin
    .from("knowledge_chunks")
    .select('"embeddingStatus", "charCount"')
    .eq("sourceId", id);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  const embeddingCounts: Record<string, number> = {};
  let totalChars = 0;
  for (const c of all ?? []) {
    embeddingCounts[c.embeddingStatus] = (embeddingCounts[c.embeddingStatus] ?? 0) + 1;
    totalChars += c.charCount ?? 0;
  }
  const chunkCount = all?.length ?? 0;

  const from = (page - 1) * pageSize;
  const { data: rows, error: cErr } = await admin
    .from("knowledge_chunks")
    .select('id, "chunkIndex", content, "charCount", "embeddingStatus", "createdAt"')
    .eq("sourceId", id)
    .order("chunkIndex", { ascending: true })
    .range(from, from + pageSize - 1);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });

  const chunks = (rows ?? []).map((r: { content: string } & Record<string, unknown>) => ({
    ...r,
    content: r.content.length > PREVIEW_CHARS ? r.content.slice(0, PREVIEW_CHARS) + "…" : r.content,
    truncated: r.content.length > PREVIEW_CHARS,
  }));

  // Blockers a reviewer should resolve before approval.
  const blockers: string[] = [];
  if (chunkCount === 0) blockers.push("No chunks extracted — nothing to retrieve");
  if (["LICENSE_UNKNOWN", "LICENSE_REQUIRES_REVIEW", "RESTRICTED"].includes(source.licenseStatus)) {
    blockers.push(`Licence status ${source.licenseStatus} blocks approval`);
  }

  return NextResponse.json({
    source: {
      id: source.id, version: source.version, title: source.title,
      approvalStatus: source.approvalStatus, licenseStatus: source.licenseStatus,
      isCurrentProduction: source.isCurrentProduction,
    },
    ingestion: {
      chunkCount, totalChars, sourceCharCount: source.contentCharCount,
      embeddingCounts,
      note: "Retrieval uses keyword (full-text) search over chunks; semantic embeddings are not generated in this build.",
    },
    blockers,
    page, pageSize, chunks,
  });
}
