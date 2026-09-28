import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getBibleProvider, bibleProviderStatus } from "@/lib/bibleProvider";
import { getAIProvider, aiProviderStatus } from "@/lib/aiProvider";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

// PRODUCTION HEALTH CHECK (Phase 16 §7) — distinct from unit and integration
// tests: this runs live against the deployed environment's real
// credentials, on demand, from the admin screen. Reports one of:
// NOT_CONFIGURED (no credentials), CONNECTED, or ERROR (credentials
// present but the provider call failed). Never returns the credential.
export async function GET() {
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

  const { data: settings } = await supabase.from("ai_pastor_settings").select("aiModel").eq("id", true).single();

  const bible =
    bibleProviderStatus() === "NOT_CONFIGURED"
      ? { status: "NOT_CONFIGURED" as const }
      : await getBibleProvider()!.healthCheck().then((r) => ({ status: r.ok ? ("CONNECTED" as const) : ("ERROR" as const), detail: r.detail }));

  const ai =
    aiProviderStatus() === "NOT_CONFIGURED"
      ? { status: "NOT_CONFIGURED" as const }
      : await getAIProvider(settings?.aiModel)!.healthCheck().then((r) => ({ status: r.ok ? ("CONNECTED" as const) : ("ERROR" as const), detail: r.detail }));

  return NextResponse.json({ bible, ai, checkedAt: new Date().toISOString() });
}
