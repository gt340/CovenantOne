import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { describeAll, supportedProviders } from "@/lib/ai/registry";
import { MEDIA_MODES } from "@/lib/aiPastor/mediaPolicy";
import { DEFAULT_LIMITS, parseLimits } from "@/lib/aiPastor/rateLimit";

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

// Returns provider/model/status/capabilities/mode — safe metadata only. No
// key value is ever read back into a response (Phase 16 amendment §13/§19).
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const admin = getAdminClient();
  const [{ data: settings }, { data: translations }] = await Promise.all([
    admin.from("ai_pastor_settings").select("*").eq("id", true).single(),
    admin.from("bible_translations").select("id, name, abbreviation, languageName").order("name"),
  ]);

  return NextResponse.json({
    providers: describeAll(settings),
    supported: { text: supportedProviders("text"), image: supportedProviders("image"), video: supportedProviders("video") },
    bibleDefaultTranslationId: settings?.bibleDefaultTranslationId ?? null,
    availableTranslations: translations ?? [],
    mediaMode: settings?.mediaMode ?? "OFF",
    mediaModes: MEDIA_MODES,
    rateLimits: parseLimits(settings?.rateLimits),
    defaultRateLimits: DEFAULT_LIMITS,
    theologicalProfile: settings?.theologicalProfile ?? null,
  });
}

// PATCH { textProvider?, imageProvider?, videoProvider?, textModel?, imageModel?,
//         videoModel?, bibleDefaultTranslationId?, mediaMode?, rateLimits?, theologicalProfile? }
// Core safety rules are NOT configurable here — they live in code
// (systemPrompt.ts, safetyBoundaries.ts, mediaPolicy.ts's guardrail text),
// so no admin setting can weaken them.
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = getAdminClient();
  const update: Record<string, unknown> = { updatedByUserId: auth.user.id, updatedAt: new Date().toISOString() };

  for (const [kind, col] of [["text", "textProvider"], ["image", "imageProvider"], ["video", "videoProvider"]] as const) {
    if (typeof body[col] === "string") {
      if (!supportedProviders(kind).includes((body[col] as string).toLowerCase())) {
        return NextResponse.json({ error: `${body[col]} does not support ${kind} generation` }, { status: 400 });
      }
      update[col] = body[col];
    }
  }
  for (const col of ["textModel", "imageModel", "videoModel"] as const) {
    if (typeof body[col] === "string") update[col] = body[col];
  }

  if (typeof body.bibleDefaultTranslationId === "string") {
    // Only translations the provider actually returned may be selected — no invented IDs.
    const { data: known } = await admin.from("bible_translations").select("id").eq("id", body.bibleDefaultTranslationId).maybeSingle();
    if (!known) return NextResponse.json({ error: "Unknown translation. Sync the provider's translation list first, then pick from it." }, { status: 400 });
    update.bibleDefaultTranslationId = body.bibleDefaultTranslationId;
  }

  if (typeof body.mediaMode === "string") {
    if (!MEDIA_MODES.includes(body.mediaMode as any)) return NextResponse.json({ error: `mediaMode must be one of ${MEDIA_MODES.join(", ")}` }, { status: 400 });
    update.mediaMode = body.mediaMode;
  }
  if (body.rateLimits !== undefined) update.rateLimits = parseLimits(body.rateLimits); // clamped, never trusted raw
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
