import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireVerifiableUser } from "@/lib/auth/session";
import { phoneNumberSchema, firstErrorMessage } from "@/lib/validation/registration";
import { generateOtpCode, hashOtpCode, otpExpiryDate } from "@/lib/domain/otp";
import { sendOtpSms } from "@/lib/domain/sms-provider";

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

  const parsed = phoneNumberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: firstErrorMessage(parsed.error) },
      { status: 422 }
    );
  }

  const { phoneE164 } = parsed.data;
  const supabase = createClient();

  const code = generateOtpCode();
  const { error } = await supabase.from("phone_verifications").upsert(
    {
      userId: auth.user.id,
      phoneE164,
      status: "PENDING",
      otpCodeHash: hashOtpCode(code),
      otpExpiresAt: otpExpiryDate().toISOString(),
      otpAttempts: 0,
    },
    { onConflict: "userId" }
  );

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "This phone number is already associated with another account." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  try {
    const smsResult = await sendOtpSms(phoneE164, code);
    return NextResponse.json({
      ok: true,
      devModeCode: smsResult.devModeCode,
      testingBypass: smsResult.testingBypass ?? false,
    });
  } catch (smsError) {
    return NextResponse.json(
      { ok: false, error: (smsError as Error).message },
      { status: 503 }
    );
  }
}
