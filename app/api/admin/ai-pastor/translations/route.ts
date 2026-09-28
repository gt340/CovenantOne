import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getBibleProvider, bibleProviderStatus } from "@/lib/bibleProvider";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

// POST: pulls the provider's real translation catalog and upserts it into
// bible_translations, so the admin picks a default from what the provider
// actually licenses to this API key. Nothing is invented locally.
export async function POST() {
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

  if (bibleProviderStatus() === "NOT_CONFIGURED") {
    return NextResponse.json({ status: "NOT_CONFIGURED", error: "BIBLE_API_KEY is not set in the deployment environment." }, { status: 503 });
  }

  try {
    const translations = await getBibleProvider()!.getTranslations();
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const rows = translations.map((t) => ({
      id: t.id,
      provider: "API_BIBLE",
      name: t.name,
      nameLocal: t.nameLocal ?? null,
      abbreviation: t.abbreviation ?? null,
      language: t.language ?? null,
      languageName: t.languageName ?? null,
      description: t.description ?? null,
      fetchedAt: new Date().toISOString(),
    }));
    const { error } = await admin.from("bible_translations").upsert(rows, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await admin.from("audit_logs").insert({
      actorUserId: user.id,
      action: "BIBLE_TRANSLATIONS_SYNCED",
      targetType: "bible_translations",
      metadata: { count: rows.length },
    });
    return NextResponse.json({ status: "OK", synced: rows.length });
  } catch (err) {
    return NextResponse.json({ status: "PROVIDER_ERROR", error: err instanceof Error ? err.message : "Unknown error" }, { status: 502 });
  }
}
