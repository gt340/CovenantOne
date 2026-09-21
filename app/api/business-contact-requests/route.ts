import { NextResponse } from "next/server";
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

// Combined inbox: requests I sent + requests sent to any business I own.
// RLS (contact_requests_select_own + contact_requests_select_owner) already scopes this correctly;
// this route just labels each row so the UI can tell which side you're on.
export async function GET() {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("business_contact_requests")
    .select("id, businessId, requesterId, purpose, message, status, responseMessage, createdAt")
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const businessIds = [...new Set((data ?? []).map((r: any) => r.businessId))];
  const requesterIds = [...new Set((data ?? []).map((r: any) => r.requesterId))];

  const [{ data: businesses }, { data: profiles }] = await Promise.all([
    businessIds.length ? supabase.from("business_profiles").select("id, businessName, ownerId").in("id", businessIds) : Promise.resolve({ data: [] as any[] }),
    requesterIds.length ? supabase.from("member_profiles").select("userId, displayName").in("userId", requesterIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const businessById = new Map((businesses ?? []).map((b: any) => [b.id, b]));
  const nameByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p.displayName]));

  return NextResponse.json({
    requests: (data ?? []).map((r: any) => ({
      ...r,
      businessName: businessById.get(r.businessId)?.businessName ?? "Business",
      requesterName: nameByUser.get(r.requesterId) ?? "Member",
      iAmOwner: businessById.get(r.businessId)?.ownerId === user.id,
    })),
  });
}
