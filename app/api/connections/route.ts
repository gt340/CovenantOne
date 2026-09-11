import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { STAGE_LABELS, Stage } from "@/lib/relationshipStages";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

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

export async function GET() {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: connections, error } = await supabase
    .from("connections")
    .select("id, userAId, userBId, status, currentStage, pendingStage, createdAt")
    .or(`userAId.eq.${user.id},userBId.eq.${user.id}`)
    .order("createdAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const otherIds = (connections ?? []).map((c: any) => (c.userAId === user.id ? c.userBId : c.userAId));
  const admin = getAdminClient();
  const { data: profiles } = await admin
    .from("member_profiles")
    .select("userId, displayName, headlinePhotoKey")
    .in("userId", otherIds.length ? otherIds : ["00000000-0000-0000-0000-000000000000"]);
  const profileByUser = new Map((profiles ?? []).map((p: any) => [p.userId, p]));

  const photoUrls = new Map<string, string>();
  await Promise.all(
    (profiles ?? []).map(async (p: any) => {
      if (!p.headlinePhotoKey) return;
      const { data } = await admin.storage.from("profile-photos").createSignedUrl(p.headlinePhotoKey, 3600);
      if (data?.signedUrl) photoUrls.set(p.userId, data.signedUrl);
    })
  );

  const result = (connections ?? []).map((c: any) => {
    const otherId = c.userAId === user.id ? c.userBId : c.userAId;
    const profile = profileByUser.get(otherId);
    return {
      id: c.id,
      status: c.status,
      currentStage: c.currentStage,
      currentStageLabel: STAGE_LABELS[c.currentStage as Stage] ?? c.currentStage,
      hasPendingProposal: !!c.pendingStage,
      createdAt: c.createdAt,
      otherMember: {
        id: otherId,
        displayName: profile?.displayName ?? "Member",
        headlinePhotoUrl: photoUrls.get(otherId) ?? null,
      },
    };
  });

  return NextResponse.json({ connections: result });
}
