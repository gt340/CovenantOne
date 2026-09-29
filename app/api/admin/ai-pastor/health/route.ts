import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getBibleProvider, bibleProviderStatus } from "@/lib/bibleProvider";
import { getImageProvider, getTextProvider, getVideoProvider, resolveProvider } from "@/lib/ai/registry";
import type { HealthResult } from "@/lib/ai/types";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

// PRODUCTION HEALTH CHECK (Phase 16 amendment §15) — distinct from unit and
// integration tests: runs live against the deployed environment's real
// credentials, on demand. Each of Bible / text / image / video is reported
// independently — a missing optional provider (image, video) never fails
// the whole check, and a missing required one (text) is reported as
// NOT_CONFIGURED, never masked as something else. No credential is ever
// returned.
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

  const { data: settings } = await supabase.from("ai_pastor_settings").select("*").eq("id", true).single();

  async function check(configured: boolean, run: () => Promise<HealthResult>): Promise<HealthResult> {
    if (!configured) return { state: "NOT_CONFIGURED" };
    try {
      return await run();
    } catch (err) {
      return { state: "ERROR", detail: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  const bible = await check(bibleProviderStatus() === "CONFIGURED", async () => {
    const r = await getBibleProvider()!.healthCheck();
    return { state: r.ok ? "READY" : "ERROR", detail: r.detail };
  });

  const textResolved = resolveProvider("text", settings);
  const text = await check(textResolved.state === "READY", () => getTextProvider(settings)!.healthCheck());

  const imageResolved = resolveProvider("image", settings);
  const image =
    imageResolved.state === "UNSUPPORTED"
      ? { state: "UNSUPPORTED" as const, detail: imageResolved.detail }
      : await check(imageResolved.state === "READY", () => getImageProvider(settings)!.healthCheck());

  const videoResolved = resolveProvider("video", settings);
  const video =
    videoResolved.state === "UNSUPPORTED"
      ? { state: "UNSUPPORTED" as const, detail: videoResolved.detail }
      : await check(videoResolved.state === "READY", () => getVideoProvider(settings)!.healthCheck());

  return NextResponse.json({
    bible: { ...bible, provider: "API_BIBLE" },
    text: { ...text, provider: textResolved.provider, model: textResolved.model },
    image: { ...image, provider: imageResolved.provider, model: imageResolved.model },
    video: { ...video, provider: videoResolved.provider, model: videoResolved.model },
    checkedAt: new Date().toISOString(),
  });
}
