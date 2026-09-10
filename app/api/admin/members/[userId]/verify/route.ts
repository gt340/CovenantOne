import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getAuthedRole() {
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
  if (!user) return { user: null, role: null };

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  return { user, role: profile?.role ?? null };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const { user, role } = await getAuthedRole();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!role || !ADMIN_ROLES.includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { communityVerified?: boolean; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { communityVerified, reason } = body;
  if (typeof communityVerified !== "boolean") {
    return NextResponse.json(
      { error: "communityVerified (boolean) is required" },
      { status: 400 }
    );
  }
  if (!reason || !reason.trim()) {
    return NextResponse.json(
      { error: "A reason is required for the audit log" },
      { status: 400 }
    );
  }

  const admin = getAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from("member_profiles")
    .select("userId, communityVerified")
    .eq("userId", userId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { data: updated, error: updateError } = await admin
    .from("member_profiles")
    .update({
      communityVerified,
      communityVerifiedAt: communityVerified ? new Date().toISOString() : null,
      communityVerifiedByUserId: communityVerified ? user.id : null,
    })
    .eq("userId", userId)
    .select("userId, communityVerified, communityVerifiedAt")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    actorUserId: user.id,
    action: communityVerified
      ? "COMMUNITY_VERIFICATION_GRANTED"
      : "COMMUNITY_VERIFICATION_REVOKED",
    targetType: "user",
    targetId: userId,
    metadata: { reason: reason.trim(), previousValue: existing.communityVerified },
  });

  if (auditError) {
    // The verification change already succeeded; surface the audit
    // failure without rolling back, since it's the less critical write.
    return NextResponse.json(
      {
        ...updated,
        warning: "Verification updated but audit log entry failed to write.",
      },
      { status: 200 }
    );
  }

  return NextResponse.json(updated);
}
