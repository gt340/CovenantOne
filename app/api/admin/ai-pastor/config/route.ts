import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { bibleProviderStatus } from "@/lib/bibleProvider";
import { aiProviderStatus } from "@/lib/aiProvider";

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
  if (!profile || !ADMIN_ROLES.includes(profile.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

// Returns configuration and NOT_CONFIGURED/CONFIGURED state only. Never
// returns a secret value — the API keys live in env vars and are never read
// back into any response (Phase 16 §5).
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const admin = getAdminClient();
  const [{ data: settings }, { data: translations }] = await Promise.all([
    admin.from("ai_pastor_settings").select("*").eq("id", true).single(),
    admin.from("bible_translations").select("id, name, abbreviation, languageName").order("name"),
  ]);

  return NextResponse.json({
    bibleProvider: { name: settings?.bibleProvider ?? "API_BIBLE", credentials: bibleProviderStatus() },
    aiProvider: { name: settings?.aiProvider ?? "ANTHROPIC", credentials: aiProviderStatus() },
    defaultTranslationId: settings?.bibleDefaultTranslationId ?? null,
    aiModel: settings?.aiModel ?? null,
    theologicalProfile: settings?.theologicalProfile ?? null,
    availableTranslations: translations ?? [],
  });
}

// PATCH { defaultTranslationId?, aiModel?, theologicalProfile? }. Core
// safety rules are deliberately NOT configurable here — they live in code
// (src/lib/aiPastor/systemPrompt.ts and safetyBoundaries.ts), so no admin
// setting can weaken them (Phase 16 §13).
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: { defaultTranslationId?: string; aiModel?: string; theologicalProfile?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = getAdminClient();
  const update: Record<string, unknown> = { updatedByUserId: auth.user.id, updatedAt: new Date().toISOString() };

  if (body.defaultTranslationId !== undefined) {
    // Only translations the provider actually returned may be selected — no invented IDs.
    const { data: known } = await admin.from("bible_translations").select("id").eq("id", body.defaultTranslationId).maybeSingle();
    if (!known) {
      return NextResponse.json({ error: "Unknown translation. Sync the provider's translation list first, then pick from it." }, { status: 400 });
    }
    update.bibleDefaultTranslationId = body.defaultTranslationId;
  }
  if (body.aiModel !== undefined) update.aiModel = body.aiModel;
  if (body.theologicalProfile !== undefined) update.theologicalProfile = body.theologicalProfile;

  const { error } = await admin.from("ai_pastor_settings").update(update).eq("id", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_logs").insert({
    actorUserId: auth.user.id,
    action: "AI_PASTOR_CONFIG_UPDATED",
    targetType: "ai_pastor_settings",
    targetId: "singleton",
    metadata: { changedKeys: Object.keys(body) },
  });

  return NextResponse.json({ updated: true });
}
