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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, posterId, businessId, title, company, description, location, isRemote, category, isActive, isRemoved, createdAt")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  let business = null;
  if (job.businessId) {
    const { data } = await supabase
      .from("business_profiles")
      .select("id, businessName, category, description, website")
      .eq("id", job.businessId)
      .maybeSingle();
    business = data;
  }

  const { data: myApplication } = await supabase
    .from("job_applications")
    .select("id, status")
    .eq("jobId", id)
    .eq("applicantId", user.id)
    .maybeSingle();

  return NextResponse.json({ ...job, business, myApplication: myApplication ?? null });
}

// Edit own job (poster) or moderator action (isRemoved).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    title?: string;
    description?: string;
    isActive?: boolean;
    isRemoved?: boolean;
    removedReason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.description !== undefined) update.description = body.description.trim();
  if (body.isActive !== undefined) update.isActive = body.isActive;
  if (body.isRemoved !== undefined) {
    update.isRemoved = body.isRemoved;
    update.removedByUserId = body.isRemoved ? user.id : null;
    update.removedReason = body.isRemoved ? body.removedReason?.trim() || "Policy violation" : null;
    update.removedAt = body.isRemoved ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase.from("jobs").update(update).eq("id", id).select().single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json({ error: "Not authorized to make this change" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
  }
