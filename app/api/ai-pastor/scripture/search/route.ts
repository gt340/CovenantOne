import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getBibleProvider, bibleProviderStatus } from "@/lib/bibleProvider";

async function requireUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// GET /api/ai-pastor/scripture/search?q=...&translation=...
export async function GET(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (bibleProviderStatus() === "NOT_CONFIGURED") {
    return NextResponse.json({ status: "NOT_CONFIGURED", results: [] }, { status: 503 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });

  let translation = request.nextUrl.searchParams.get("translation");
  if (!translation) {
    const { data: settings } = await supabase.from("ai_pastor_settings").select("bibleDefaultTranslationId").eq("id", true).single();
    translation = settings?.bibleDefaultTranslationId ?? null;
  }
  if (!translation) {
    return NextResponse.json({ status: "NO_DEFAULT_TRANSLATION", results: [] }, { status: 503 });
  }

  const provider = getBibleProvider()!;
  const results = await provider.search(q, translation, 15);
  return NextResponse.json({ status: "OK", results });
}
