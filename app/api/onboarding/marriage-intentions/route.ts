import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth/session";
import { marriageIntentionSchema, firstErrorMessage } from "@/lib/validation/registration";

export async function POST(request: Request) {
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

  const parsed = marriageIntentionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: firstErrorMessage(parsed.error) },
      { status: 422 }
    );
  }

  const { timeframe, wantsChildren, hasChildrenAlready } = parsed.data;
  const supabase = createClient();

  const { error } = await supabase.from("marriage_intentions").upsert(
    {
      userId: auth.user.id,
      timeframe,
      wantsChildren: wantsChildren ?? null,
      hasChildrenAlready,
    },
    { onConflict: "userId" }
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Profile completion step: mark the member discoverable once the core
  // onboarding fields exist. Real compatibility/discovery logic is out of
  // scope for this phase (per the Phase 2 instruction) — this only flips the
  // flag that a future discovery feature would read.
  const { error: discoverableError } = await supabase
    .from("member_profiles")
    .update({ isDiscoverable: true })
    .eq("userId", auth.user.id);

  if (discoverableError) {
    return NextResponse.json({ ok: false, error: discoverableError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
