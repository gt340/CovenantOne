import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth/session";
import { personalInfoSchema, firstErrorMessage } from "@/lib/validation/registration";

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

  const parsed = personalInfoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: firstErrorMessage(parsed.error) },
      { status: 422 }
    );
  }

  const { fullName, dateOfBirth, gender, country, city, maritalStatus } = parsed.data;

  const supabase = createClient();

  // upsert semantics: a member may revisit this step during onboarding.
  const { error } = await supabase.from("member_profiles").upsert(
    {
      userId: auth.user.id,
      displayName: fullName,
      dateOfBirth,
      gender,
      maritalStatus,
      // country/city land on location_profiles, a separate table, per the
      // Phase 1 schema — written alongside member_profiles in the same call
      // so this one API request completes the whole "personal information"
      // step atomically from the client's point of view.
    },
    { onConflict: "userId" }
  );

  if (error) {
    // Postgres unique_violation
    if (error.code === "23514") {
      return NextResponse.json(
        { ok: false, error: "You must be at least 18 years old to join." },
        { status: 422 }
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const { error: locationError } = await supabase.from("location_profiles").upsert(
    { userId: auth.user.id, country, city },
    { onConflict: "userId" }
  );

  if (locationError) {
    return NextResponse.json({ ok: false, error: locationError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
