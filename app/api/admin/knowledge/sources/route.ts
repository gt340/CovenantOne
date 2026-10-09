import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { validateRawContent, chunkText } from "@/lib/aiPastor/knowledgeIngestion";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const SOURCE_TYPES = [
  "BIBLE_API","BIBLE_DATASET","SERMON","TEACHING","ARTICLE","BOOK","COURSE",
  "STUDY_GUIDE","COVENANTONE_DOCUMENT","FAQ","POLICY","OTHER_APPROVED_SOURCE",
];

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

// GET — list sources with filter/search (Phase 18 §15). Only admin-tier can
// see this list at all (RLS backs this up independently — see migration).
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const sourceType = searchParams.get("sourceType");
  const search = searchParams.get("search")?.trim();
  const lineageId = searchParams.get("lineageId");

  const admin = getAdminClient();
  let query = admin
    .from("knowledge_sources")
    .select(
      'id, "lineageId", version, "isCurrentProduction", title, author, "sourceType", "approvalStatus", "licenseStatus", "trustLevel", "uploaderUserId", "createdAt", "updatedAt"'
    )
    .order("updatedAt", { ascending: false });

  if (status) query = query.eq("approvalStatus", status);
  if (sourceType) query = query.eq("sourceType", sourceType);
  if (lineageId) query = query.eq("lineageId", lineageId);
  if (search) query = query.ilike("title", `%${search}%`);

  const { data, error } = await query.limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: data ?? [] });
}

// POST — create a new source as DRAFT (Phase 18 §5/§9). Ingestion scope:
// plain text/markdown only (see knowledgeIngestion.ts) — validated, cleaned,
// and chunked synchronously here. No embedding is generated (documented
// limitation, not silently skipped).
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: {
    title?: string; author?: string; organization?: string; sourceType?: string; description?: string;
    language?: string; publicationDate?: string; copyrightInfo?: string; licenseStatus?: string;
    licenseNotes?: string; sourceUrl?: string; trustLevel?: string; rawContent?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!body.sourceType || !SOURCE_TYPES.includes(body.sourceType)) {
    return NextResponse.json({ error: `sourceType must be one of ${SOURCE_TYPES.join(", ")}` }, { status: 400 });
  }
  const content = body.rawContent ?? "";
  const validationError = validateRawContent(content);
  if (validationError) return NextResponse.json({ error: `rawContent invalid: ${validationError}` }, { status: 400 });

  const admin = getAdminClient();
  const { data: source, error } = await admin
    .from("knowledge_sources")
    .insert({
      title: body.title.trim(),
      author: body.author?.trim() || null,
      organization: body.organization?.trim() || null,
      sourceType: body.sourceType,
      description: body.description?.trim() || null,
      language: body.language?.trim() || "en",
      publicationDate: body.publicationDate || null,
      copyrightInfo: body.copyrightInfo?.trim() || null,
      // Default stays LICENSE_REQUIRES_REVIEW unless the admin explicitly
      // asserts otherwise — §4: "do not invent copyright or licensing information."
      licenseStatus: body.licenseStatus || "LICENSE_REQUIRES_REVIEW",
      licenseNotes: body.licenseNotes?.trim() || null,
      sourceUrl: body.sourceUrl?.trim() || null,
      trustLevel: body.trustLevel || "UNVERIFIED",
      rawContent: content,
      contentCharCount: content.length,
      uploaderUserId: auth.user.id,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const chunks = chunkText(content);
  if (chunks.length > 0) {
    const { error: chunkError } = await admin.from("knowledge_chunks").insert(
      chunks.map((c, i) => ({ sourceId: source.id, chunkIndex: i, content: c, charCount: c.length }))
    );
    if (chunkError) return NextResponse.json({ error: `source created but chunking failed: ${chunkError.message}` }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    actorUserId: auth.user.id,
    action: "KNOWLEDGE_SOURCE_CREATED",
    targetType: "knowledge_sources",
    targetId: source.id,
    metadata: { title: source.title, sourceType: source.sourceType, chunkCount: chunks.length },
  });

  return NextResponse.json({ source, chunkCount: chunks.length }, { status: 201 });
}
