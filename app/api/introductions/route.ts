import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getAuthedUser() {
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
  return user;
}

const REQUEST_EXPIRY_DAYS = 30;

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { recipientId?: string; introMessage?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recipientId = body.recipientId;
  const introMessage = body.introMessage?.trim() || null;

  if (!recipientId) {
    return NextResponse.json({ error: "recipientId is required" }, { status: 400 });
  }
  if (recipientId === authedUser.id) {
    return NextResponse.json({ error: "Cannot send a request to yourself" }, { status: 400 });
  }

  const admin = getAdminClient();

  const [{ data: requester }, { data: recipient }] = await Promise.all([
    admin.from("users").select("status").eq("id", authedUser.id).single(),
    admin.from("users").select("status").eq("id", recipientId).single(),
  ]);

  if (!requester || requester.status !== "ACTIVE") {
    return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
  }
  if (!recipient || recipient.status !== "ACTIVE") {
    return NextResponse.json({ error: "Member not found or not active" }, { status: 404 });
  }

  const [{ data: requesterProfile }, { data: recipientProfile }] = await Promise.all([
    admin.from("member_profiles").select("gender").eq("userId", authedUser.id).single(),
    admin.from("member_profiles").select("gender, isDiscoverable").eq("userId", recipientId).single(),
  ]);

  if (!requesterProfile || !recipientProfile) {
    return NextResponse.json({ error: "Complete your profile first" }, { status: 400 });
  }
  if (requesterProfile.gender === recipientProfile.gender) {
    return NextResponse.json({ error: "This platform matches opposite-gender members only" }, { status: 403 });
  }
  if (!recipientProfile.isDiscoverable) {
    return NextResponse.json({ error: "This member is not currently discoverable" }, { status: 403 });
  }

  const [{ data: blockedByMe }, { data: blockedMe }] = await Promise.all([
    admin.from("blocks").select("id").eq("blockerId", authedUser.id).eq("blockedId", recipientId).maybeSingle(),
    admin.from("blocks").select("id").eq("blockerId", recipientId).eq("blockedId", authedUser.id).maybeSingle(),
  ]);
  if (blockedByMe || blockedMe) {
    return NextResponse.json({ error: "Unable to send a request to this member" }, { status: 403 });
  }

  const { data: existingConnection } = await admin
    .from("connections")
    .select("id")
    .or(
      `and(userAId.eq.${authedUser.id},userBId.eq.${recipientId}),and(userAId.eq.${recipientId},userBId.eq.${authedUser.id})`
    )
    .maybeSingle();
  if (existingConnection) {
    return NextResponse.json({ error: "You are already connected with this member" }, { status: 409 });
  }

  const { data: existingRequest } = await admin
    .from("introduction_requests")
    .select("id, status")
    .or(
      `and(requesterId.eq.${authedUser.id},recipientId.eq.${recipientId}),and(requesterId.eq.${recipientId},recipientId.eq.${authedUser.id})`
    )
    .in("status", ["PENDING", "ACCEPTED"])
    .maybeSingle();
  if (existingRequest) {
    return NextResponse.json(
      { error: "A request already exists between you and this member", requestId: existingRequest.id },
      { status: 409 }
    );
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REQUEST_EXPIRY_DAYS);

  const { data: created, error } = await admin
    .from("introduction_requests")
    .insert({
      requesterId: authedUser.id,
      recipientId,
      introMessage,
      status: "PENDING",
      expiresAt: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(created, { status: 201 });
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const direction = searchParams.get("direction"); // "sent" | "received" | null (both)
  const statusFilter = searchParams.get("status"); // e.g. "PENDING"

  const admin = getAdminClient();
  let query = admin
    .from("introduction_requests")
    .select(
      "id, requesterId, recipientId, status, introMessage, respondedAt, expiresAt, createdAt"
    )
    .order("createdAt", { ascending: false });

  if (direction === "sent") {
    query = query.eq("requesterId", authedUser.id);
  } else if (direction === "received") {
    query = query.eq("recipientId", authedUser.id);
  } else {
    query = query.or(`requesterId.eq.${authedUser.id},recipientId.eq.${authedUser.id}`);
  }
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Attach basic display info for the "other" party in each request.
  const otherIds = Array.from(
    new Set((data ?? []).map((r: any) => (r.requesterId === authedUser.id ? r.recipientId : r.requesterId)))
  );
  const { data: profiles } = await admin
    .from("member_profiles")
    .select("userId, displayName, headlinePhotoKey")
    .in("userId", otherIds);
  const profileByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p]));

  const photoUrls = new Map<string, string>();
  await Promise.all(
    (profiles ?? []).map(async (p: any) => {
      if (!p.headlinePhotoKey) return;
      const { data: signed } = await admin.storage
        .from("profile-photos")
        .createSignedUrl(p.headlinePhotoKey, 3600);
      if (signed?.signedUrl) photoUrls.set(p.userId, signed.signedUrl);
    })
  );

  const requests = (data ?? []).map((r: any) => {
    const otherId = r.requesterId === authedUser.id ? r.recipientId : r.requesterId;
    const otherProfile = profileByUser.get(otherId);
    return {
      id: r.id,
      direction: r.requesterId === authedUser.id ? "sent" : "received",
      status: r.status,
      introMessage: r.introMessage,
      respondedAt: r.respondedAt,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      otherMember: {
        id: otherId,
        displayName: otherProfile?.displayName ?? "Member",
        headlinePhotoUrl: photoUrls.get(otherId) ?? null,
      },
    };
  });

  return NextResponse.json({ requests });
}
