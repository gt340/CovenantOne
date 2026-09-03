import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth/session";
import { z } from "zod";

const confirmPhotoSchema = z.object({
  storageKey: z.string().trim().min(1).max(500),
});

export async function PATCH(request: Request) {
  const auth = await requireActiveUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const parsed = confirmPhotoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid photo reference." }, { status: 422 });
  }

  const { storageKey } = parsed.data;

  // Defense in depth: the storage RLS policy already prevents uploading
  // outside your own folder, but re-check the path prefix here too so a
  // malformed/forged key can never get recorded as someone's headline
  // photo even if some future code path skips the upload step.
  if (!storageKey.startsWith(`${auth.user.id}/`)) {
    return NextResponse.json(
      { ok: false, error: "That photo doesn't belong to your account." },
      { status: 403 }
    );
  }

  const supabase = createClient();

  // Confirm the object actually exists and is genuinely readable by this
  // user before recording it — otherwise a client could claim an upload
  // that never completed.
  const { data: signedUrlCheck } = await supabase.storage
    .from("profile-photos")
    .createSignedUrl(storageKey, 60);

  if (!signedUrlCheck) {
    return NextResponse.json(
      { ok: false, error: "We couldn't find that uploaded photo. Try uploading again." },
      { status: 422 }
    );
  }

  const { data: existing } = await supabase
    .from("member_profiles")
    .select("photoKeys")
    .eq("userId", auth.user.id)
    .maybeSingle();

  const existingKeys: string[] = existing?.photoKeys ?? [];
  const updatedKeys = existingKeys.includes(storageKey)
    ? existingKeys
    : [...existingKeys, storageKey];

  const { error } = await supabase
    .from("member_profiles")
    .update({ headlinePhotoKey: storageKey, photoKeys: updatedKeys })
    .eq("userId", auth.user.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const auth = await requireActiveUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
  }

  const supabase = createClient();

  // Removing the headline photo reference only — the underlying storage
  // object is left in place rather than deleted here, matching the same
  // "soft" pattern used for account deletion elsewhere in this app (a
  // reversible reference change now, a separate cleanup job for the
  // orphaned object later, not built yet — see PHASE3_REPORT.md).
  const { error } = await supabase
    .from("member_profiles")
    .update({ headlinePhotoKey: null })
    .eq("userId", auth.user.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
