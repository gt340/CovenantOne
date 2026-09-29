import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { bibleProviderStatus } from "@/lib/bibleProvider";
import { describeAll } from "@/lib/ai/registry";

// Public-to-any-authenticated-member status check — lets the chat UI show a
// clear "not configured yet" state instead of a confusing failure. Reports
// state only (READY / NOT_CONFIGURED / UNSUPPORTED / ...), never a secret.
export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: settings } = await supabase.from("ai_pastor_settings").select("*").eq("id", true).single();
  const providers = describeAll(settings);

  return NextResponse.json({
    bibleProvider: bibleProviderStatus() === "CONFIGURED" ? "READY" : "NOT_CONFIGURED",
    aiTextProvider: providers.text.state,
    imageProvider: providers.image.state,
    videoProvider: providers.video.state,
    mediaMode: settings?.mediaMode ?? "OFF",
  });
}
