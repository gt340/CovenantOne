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

  const { data: business, error } = await supabase
    .from("business_profiles")
    .select("id, ownerId, businessName, categorySlug, description, website, isPublic, isRemoved, openToPartnership, partnershipNotes, bannerImageKey")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const { data: offerings } = await supabase
    .from("business_offerings")
    .select("id, name, description")
    .eq("businessId", id);

  return NextResponse.json({ ...business, offerings: offerings ?? [] });
}

// Edit own listing, or moderator action (isRemoved).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    businessName?: string;
    description?: string;
    isPublic?: boolean;
    openToPartnership?: boolean;
    partnershipNotes?: string;
    isRemoved?: boolean;
    removedReason?: string;
    bannerImageKey?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.businessName !== undefined) update.businessName = body.businessName.trim();
  if (body.description !== undefined) update.description = body.description.trim();
  if (body.isPublic !== undefined) update.isPublic = body.isPublic;
  if (body.openToPartnership !== undefined) update.openToPartnership = body.openToPartnership;
  if (body.partnershipNotes !== undefined) update.partnershipNotes = body.partnershipNotes.trim();
  if (body.bannerImageKey !== undefined) update.bannerImageKey = body.bannerImageKey;
  if (body.isRemoved !== undefined) {
    update.isRemoved = body.isRemoved;
    update.removedByUserId = body.isRemoved ? user.id : null;
    update.removedReason = body.isRemoved ? body.removedReason?.trim() || "Policy violation" : null;
    update.removedAt = body.isRemoved ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase.from("business_profiles").update(update).eq("id", id).select().single();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return NextResponse.json({ error: "Not authorized to make this change" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
