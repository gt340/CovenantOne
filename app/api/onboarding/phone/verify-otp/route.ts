import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireVerifiableUser } from "@/lib/auth/session";
import { otpSchema, firstErrorMessage } from "@/lib/validation/registration";
import { verifyOtp } from "@/lib/domain/otp";

export async function POST(request: Request) {
  const auth = await requireVerifiableUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const parsed = otpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: firstErrorMessage(parsed.error) },
      { status: 422 }
    );
  }

  const supabase = createClient();

  const { data: record, error: fetchError } = await supabase
    .from("phone_verifications")
    .select("otpCodeHash, otpExpiresAt, otpAttempts")
    .eq("userId", auth.user.id)
    .single();

  if (fetchError || !record) {
    return NextResponse.json(
      { ok: false, error: "No phone verification in progress. Request a code first." },
      { status: 404 }
    );
  }

  const result = verifyOtp(parsed.data.code, {
    otpCodeHash: record.otpCodeHash,
    otpExpiresAt: record.otpExpiresAt ? new Date(record.otpExpiresAt) : null,
    otpAttempts: record.otpAttempts,
  });

  if (!result.ok) {
    // Always record the attempt, even on failure — that's what makes
    // TOO_MANY_ATTEMPTS actually enforceable.
    await supabase
      .from("phone_verifications")
      .update({ otpAttempts: record.otpAttempts + 1 })
      .eq("userId", auth.user.id);

    const messages: Record<string, string> = {
      NO_CODE_REQUESTED: "No code was requested. Request a code first.",
      EXPIRED: "That code has expired. Request a new one.",
      TOO_MANY_ATTEMPTS: "Too many incorrect attempts. Request a new code.",
      INCORRECT: "That code is incorrect.",
    };
    return NextResponse.json(
      { ok: false, error: messages[result.reason] },
      { status: 422 }
    );
  }

  const { error: updateError } = await supabase
    .from("phone_verifications")
    .update({ status: "VERIFIED", verifiedAt: new Date().toISOString() })
    .eq("userId", auth.user.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
