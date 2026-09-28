import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getBibleProvider, bibleProviderStatus } from "@/lib/bibleProvider";

// GET /api/ai-pastor/scripture/verse?ref=PRO.3.5&translation=...
// Provider-native passage IDs (e.g. PRO.3.5). Returns 404 when the provider
// says the reference doesn't exist — never a guess.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (bibleProviderStatus() === "NOT_CONFIGURED") {
    return NextResponse.json({ status: "NOT_CONFIGURED" }, { status: 503 });
  }

  const ref = request.nextUrl.searchParams.get("ref")?.trim();
  if (!ref || !/^[A-Z0-9]{3}\.\d+\.\d+$/i.test(ref)) {
    return NextResponse.json({ error: "ref must look like PRO.3.5" }, { status: 400 });
  }

  let translation = request.nextUrl.searchParams.get("translation");
  if (!translation) {
    const { data: settings } = await supabase.from("ai_pastor_settings").select("bibleDefaultTranslationId").eq("id", true).single();
    translation = settings?.bibleDefaultTranslationId ?? null;
  }
  if (!translation) return NextResponse.json({ status: "NO_DEFAULT_TRANSLATION" }, { status: 503 });

  const verse = await getBibleProvider()!.getVerse(ref.toUpperCase(), translation);
  if (!verse) return NextResponse.json({ error: "Reference not found" }, { status: 404 });
  return NextResponse.json({ status: "OK", verse });
}
