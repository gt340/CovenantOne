import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { validateRawContent, chunkText } from "@/lib/aiPastor/knowledgeIngestion";

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

// GET — detail: metadata, chunks, and the full version history of this
// source's lineage, so an admin can see provenance and prior approved
// versions (Phase 18 §6 "inspect source history", §19 "existing approved
// versions should remain traceable").
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const admin = getAdminClient();
  const { data: source, error } = await admin.from("knowledge_sources").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ data: chunks }, { data: versions }] = await Promise.all([
    admin.from("knowledge_chunks").select("id, chunkIndex, content, charCount, embeddingStatus").eq("sourceId", id).order("chunkIndex"),
    admin
      .from("knowledge_sources")
      .select('id, version, "approvalStatus", "isCurrentProduction", "createdAt", "reviewedAt"')
      .eq("lineageId", source.lineageId)
      .order("version"),
  ]);

  return NextResponse.json({ source, chunks: chunks ?? [], versions: versions ?? [] });
}

// PATCH — edit metadata/content. Editing an APPROVED (or archived) source
// never changes it in place (§19: "prevent silent replacement of approved
// production material") — it creates a new DRAFT version of the same
// lineage instead, which must go through review again. Editing a DRAFT or
// REJECTED source updates it directly, since nothing live depends on it yet.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: existing, error: fetchError } = await admin.from("knowledge_sources").select("*").eq("id", id).maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const editableFields = [
    "title", "author", "organization", "description", "language", "publicationDate",
    "copyrightInfo", "licenseStatus", "licenseNotes", "sourceUrl", "trustLevel", "rawContent",
  ];
  const changes: Record<string, any> = {};
  for (const f of editableFields) if (body[f] !== undefined) changes[f] = body[f];

  if (changes.rawContent !== undefined) {
    const validationError = validateRawContent(changes.rawContent);
    if (validationError) return NextResponse.json({ error: `rawContent invalid: ${validationError}` }, { status: 400 });
    changes.contentCharCount = changes.rawContent.length;
  }

  const needsNewVersion = existing.approvalStatus === "APPROVED" || existing.approvalStatus === "ARCHIVED";

  if (!needsNewVersion) {
    const { data: updated, error } = await admin.from("knowledge_sources").update(changes).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    if (changes.rawContent !== undefined) {
      await admin.from("knowledge_chunks").delete().eq("sourceId", id);
      const chunks = chunkText(changes.rawContent);
      if (chunks.length > 0) {
        await admin.from("knowledge_chunks").insert(chunks.map((c, i) => ({ sourceId: id, chunkIndex: i, content: c, charCount: c.length })));
      }
    }

    await admin.from("audit_logs").insert({
      actorUserId: auth.user.id, action: "KNOWLEDGE_SOURCE_EDITED", targetType: "knowledge_sources", targetId: id,
      metadata: { changedFields: Object.keys(changes) },
    });
    return NextResponse.json({ source: updated, newVersion: false });
  }

  // Create a new version: copy forward unchanged fields, apply edits,
  // start at DRAFT, link via supersedesId/lineageId. The OLD row is
  // untouched and stays production until this new one is approved (the
  // approval trigger in the Phase 18 migration is what actually flips it).
  const merged = { ...existing, ...changes };
  const rawContent = merged.rawContent;
  const { data: newVersion, error: insertError } = await admin
    .from("knowledge_sources")
    .insert({
      lineageId: existing.lineageId,
      version: existing.version + 1,
      supersedesId: existing.id,
      title: merged.title, author: merged.author, organization: merged.organization, sourceType: existing.sourceType,
      description: merged.description, language: merged.language, publicationDate: merged.publicationDate,
      copyrightInfo: merged.copyrightInfo, licenseStatus: merged.licenseStatus, licenseNotes: merged.licenseNotes,
      sourceUrl: merged.sourceUrl, trustLevel: merged.trustLevel, visibility: existing.visibility,
      rawContent, contentCharCount: rawContent.length,
      uploaderUserId: auth.user.id,
    })
    .select()
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });

  const chunks = chunkText(rawContent);
  if (chunks.length > 0) {
    await admin.from("knowledge_chunks").insert(chunks.map((c, i) => ({ sourceId: newVersion.id, chunkIndex: i, content: c, charCount: c.length })));
  }

  await admin.from("audit_logs").insert({
    actorUserId: auth.user.id, action: "KNOWLEDGE_SOURCE_NEW_VERSION_CREATED", targetType: "knowledge_sources", targetId: newVersion.id,
    metadata: { supersedesId: existing.id, version: newVersion.version },
  });

  return NextResponse.json({ source: newVersion, newVersion: true, previousVersionId: existing.id }, { status: 201 });
}
