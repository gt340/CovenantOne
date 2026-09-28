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

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase.from("bible_study_plans").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

// PATCH { stepIndex, completed } toggles a step; PATCH { status } pauses/completes the plan.
// RLS (bible_study_plans_own) restricts this to the plan's owner.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { stepIndex?: number; completed?: boolean; status?: "ACTIVE" | "PAUSED" | "COMPLETED" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data: plan } = await supabase.from("bible_study_plans").select("steps").eq("id", id).maybeSingle();
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (typeof body.stepIndex === "number") {
    const steps = [...(plan.steps as any[])];
    if (!steps[body.stepIndex]) return NextResponse.json({ error: "Invalid stepIndex" }, { status: 400 });
    steps[body.stepIndex] = { ...steps[body.stepIndex], completedAt: body.completed ? new Date().toISOString() : null };
    update.steps = steps;
  }
  if (body.status) update.status = body.status;

  const { data, error } = await supabase.from("bible_study_plans").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
