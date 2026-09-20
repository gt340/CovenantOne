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

// Apply as the logged-in member.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { coverNote?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { data, error } = await supabase
    .from("job_applications")
    .insert({ jobId: id, applicantId: user.id, coverNote: body.coverNote?.trim() || null })
    .select()
    .single();

  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "You've already applied to this job" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}

// Poster views applicants for their job.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: applications, error } = await supabase
    .from("job_applications")
    .select("id, applicantId, coverNote, status, createdAt")
    .eq("jobId", id)
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const applicantIds = (applications ?? []).map((a: any) => a.applicantId);
  const { data: profiles } = applicantIds.length
    ? await supabase.from("member_profiles").select("userId, displayName").in("userId", applicantIds)
    : { data: [] as any[] };
  const nameByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));

  return NextResponse.json({
    applications: (applications ?? []).map((a: any) => ({ ...a, applicantName: nameByUser.get(a.applicantId) ?? "Member" })),
  });
}
