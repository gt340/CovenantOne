import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getAuthedClientAndUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// Records a piece of supporting evidence (a document already uploaded to the private campaign-evidence
// bucket, referenced by storageKey, or a plain text description if no file was needed). RLS restricts
// this to the campaign's own organizer.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { description?: string; storageKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.description?.trim()) return NextResponse.json({ error: "description is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("campaign_evidence")
    .insert({ campaignId: id, uploadedByUserId: user.id, description: body.description.trim(), storageKey: body.storageKey || null })
    .select()
    .single();

  if (error) {
    if ((error as any).code === "PGRST116" || (error as any).code === "42501") {
      return NextResponse.json({ error: "Not authorized to add evidence to this campaign" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
