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

const CATEGORIES = ["MARRIAGE_SUPPORT", "EMERGENCY_SUPPORT", "EDUCATION", "BUSINESS_STARTUP", "FAMILY_EMERGENCY", "COMMUNITY_PROJECTS"];

// GET: public sees ACTIVE/COMPLETED/DISBURSED campaigns (RLS-enforced); ?mine=true sees your own at any status.
export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mine = searchParams.get("mine") === "true";
  const category = searchParams.get("category");

  let query = supabase
    .from("fundraising_campaigns")
    .select("id, organizerId, title, description, category, goalAmountCents, raisedAmountCents, status, deadline, verificationStatus, createdAt")
    .order("createdAt", { ascending: false });

  if (mine) query = query.eq("organizerId", user.id);
  if (category) query = query.eq("category", category);

  const { data: campaigns, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const organizerIds = [...new Set((campaigns ?? []).map((c: any) => c.organizerId))];
  const { data: profiles } = organizerIds.length
    ? await supabase.from("member_profiles").select("userId, displayName").in("userId", organizerIds)
    : { data: [] as any[] };
  const nameByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));

  return NextResponse.json({
    campaigns: (campaigns ?? []).map((c: any) => ({ ...c, organizerName: nameByUser.get(c.organizerId) ?? "Member" })),
  });
}

// POST: create a campaign. Always starts at SUBMITTED and unverified — the DB trigger would reject anything else
// from a non-moderator anyway, but we set it explicitly here too so the intent is clear in the code itself.
export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    title?: string;
    description?: string;
    category?: string;
    goalAmount?: number;
    deadline?: string;
    beneficiaryName?: string;
    beneficiaryRelationship?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.title?.trim() || !body.description?.trim() || !body.category || !body.goalAmount || !body.deadline || !body.beneficiaryName?.trim() || !body.beneficiaryRelationship?.trim()) {
    return NextResponse.json({ error: "title, description, category, goalAmount, deadline, beneficiaryName and beneficiaryRelationship are all required" }, { status: 400 });
  }
  if (!CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `category must be one of: ${CATEGORIES.join(", ")}` }, { status: 400 });
  }
  if (body.goalAmount <= 0) {
    return NextResponse.json({ error: "goalAmount must be greater than 0" }, { status: 400 });
  }
  const deadlineDate = new Date(body.deadline);
  if (deadlineDate <= new Date()) {
    return NextResponse.json({ error: "deadline must be in the future" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("fundraising_campaigns")
    .insert({
      organizerId: user.id,
      title: body.title.trim(),
      description: body.description.trim(),
      category: body.category,
      goalAmountCents: Math.round(body.goalAmount * 100),
      deadline: deadlineDate.toISOString(),
      beneficiaryName: body.beneficiaryName.trim(),
      beneficiaryRelationship: body.beneficiaryRelationship.trim(),
      status: "SUBMITTED",
    })
    .select()
    .single();

  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "You already have a campaign in progress — only one at a time is allowed" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ...data, note: "Your campaign has been submitted for review. It will not be visible to others until approved." }, { status: 201 });
}
