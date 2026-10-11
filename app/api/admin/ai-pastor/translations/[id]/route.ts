import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const LICENSE_STATUSES = ["LICENSE_VERIFIED", "LICENSE_UNKNOWN", "LICENSE_REQUIRES_REVIEW", "RESTRICTED", "PUBLIC_DOMAIN", "OTHER_APPROVED_STATUS"];

// PATCH: admin edits ONLY governance metadata for a provider-synced
// translation (enable/disable, copyright/licence notes). Name, language and
// text come from the provider and are never editable here — administrators
// control which translations are used, not what Scripture says.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (!profile || !ADMIN_ROLES.includes(profile.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  let body: { isEnabled?: boolean; copyrightInfo?: string | null; licenseStatus?: string; adminNotes?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.isEnabled !== undefined) {
    if (typeof body.isEnabled !== "boolean") return NextResponse.json({ error: "isEnabled must be boolean" }, { status: 400 });
    update.isEnabled = body.isEnabled;
  }
  if (body.copyrightInfo !== undefined) update.copyrightInfo = body.copyrightInfo?.toString().trim() || null;
  if (body.adminNotes !== undefined) update.adminNotes = body.adminNotes?.toString().trim() || null;
  if (body.licenseStatus !== undefined) {
    if (!LICENSE_STATUSES.includes(body.licenseStatus)) return NextResponse.json({ error: "Invalid licenseStatus" }, { status: 400 });
    update.licenseStatus = body.licenseStatus;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await admin.from("bible_translations").select('id, "isEnabled"').eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Translation not found — sync the provider catalog first" }, { status: 404 });

  // Never disable the translation the AI Pastor currently defaults to:
  // that would silently break Scripture retrieval. Change the default first.
  if (update.isEnabled === false) {
    const { data: settings } = await admin.from("ai_pastor_settings").select('"bibleDefaultTranslationId"').eq("id", true).single();
    if (settings?.bibleDefaultTranslationId === id) {
      return NextResponse.json({ error: "This is the current default translation. Choose a different default before disabling it." }, { status: 409 });
    }
  }

  update.updatedByUserId = user.id;
  update.updatedAt = new Date().toISOString();
  const { data, error } = await admin.from("bible_translations").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_logs").insert({
    actorUserId: user.id, action: "BIBLE_TRANSLATION_UPDATED", targetType: "bible_translations", metadata: { translationId: id, changes: Object.keys(update).filter((k) => k !== "updatedByUserId" && k !== "updatedAt"), isEnabled: update.isEnabled },
  });
  return NextResponse.json({ translation: data });
}
