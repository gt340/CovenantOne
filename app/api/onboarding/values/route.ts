import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth/session";
import { valuesSchema, firstErrorMessage } from "@/lib/validation/registration";

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

  const parsed = valuesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: firstErrorMessage(parsed.error) },
      { status: 422 }
    );
  }

  const { faithImportance, denomination, faithCommunity } = parsed.data;
  const supabase = createClient();

  const { error } = await supabase.from("faith_profiles").upsert(
    {
      userId: auth.user.id,
      faithImportance,
      denomination: denomination || null,
      faithCommunity: faithCommunity || null,
    },
    { onConflict: "userId" }
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
