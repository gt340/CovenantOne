import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getAuthedClientAndUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const EVIDENCE_TYPES = ["MESSAGE_REFERENCE", "VOICE_MESSAGE_REFERENCE", "PROFILE_SNAPSHOT", "SCREENSHOT_DESCRIPTION", "OTHER"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("evidence_records")
    .select("id, addedByUserId, evidenceType, referenceId, description, createdAt")
    .eq("caseId", caseId)
    .order("createdAt", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ evidence: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { evidenceType?: string; referenceId?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.evidenceType || !EVIDENCE_TYPES.includes(body.evidenceType)) {
    return NextResponse.json({ error: `evidenceType must be one of: ${EVIDENCE_TYPES.join(", ")}` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("evidence_records")
    .insert({
      caseId,
      addedByUserId: user.id,
      evidenceType: body.evidenceType,
      referenceId: body.referenceId?.trim() || null,
      description: body.description?.trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
