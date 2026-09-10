import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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

  const [{ data: partnerPreferences }, { data: marriageIntentions }] = await Promise.all([
    supabase.from("partner_preferences").select("*").eq("userId", user.id).maybeSingle(),
    supabase.from("marriage_intentions").select("*").eq("userId", user.id).maybeSingle(),
  ]);

  return NextResponse.json({ partnerPreferences: partnerPreferences ?? null, marriageIntentions: marriageIntentions ?? null });
}

export async function PUT(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pp = body.partnerPreferences ?? {};
  const mi = body.marriageIntentions ?? {};

  // Basic sanity checks — the DB has its own constraints too, but fail fast with clear messages.
  if (typeof pp.minAge === "number" && typeof pp.maxAge === "number" && pp.minAge > pp.maxAge) {
    return NextResponse.json({ error: "Minimum age cannot be greater than maximum age" }, { status: 400 });
  }
  if (pp.minAge !== undefined && pp.minAge < 18) {
    return NextResponse.json({ error: "Minimum age must be 18 or older" }, { status: 400 });
  }
  if (!pp.preferredGender || !["MALE", "FEMALE"].includes(pp.preferredGender)) {
    return NextResponse.json({ error: "preferredGender must be MALE or FEMALE" }, { status: 400 });
  }
  if (!mi.timeframe) {
    return NextResponse.json({ error: "Marriage timeframe is required" }, { status: 400 });
  }

  const [{ data: ppRow, error: ppError }, { data: miRow, error: miError }] = await Promise.all([
    supabase
      .from("partner_preferences")
      .upsert(
        {
          userId: user.id,
          preferredGender: pp.preferredGender,
          minAge: pp.minAge,
          maxAge: pp.maxAge,
          maxDistanceKm: pp.maxDistanceKm ?? null,
          requireSameFaith: !!pp.requireSameFaith,
          minFaithImportance: pp.minFaithImportance ?? null,
          minEducationLevel: pp.minEducationLevel ?? null,
          openToChildrenAlready: pp.openToChildrenAlready ?? true,
          openToRelocation: !!pp.openToRelocation,
          notes: pp.notes?.trim() || null,
        },
        { onConflict: "userId" }
      )
      .select()
      .single(),
    supabase
      .from("marriage_intentions")
      .upsert(
        {
          userId: user.id,
          seriouslySeekingMarriage: mi.seriouslySeekingMarriage ?? true,
          timeframe: mi.timeframe,
          wantsChildren: mi.wantsChildren ?? null,
          numberOfChildrenDesired: mi.wantsChildren ? mi.numberOfChildrenDesired ?? null : null,
          hasChildrenAlready: !!mi.hasChildrenAlready,
          notes: mi.notes?.trim() || null,
        },
        { onConflict: "userId" }
      )
      .select()
      .single(),
  ]);

  if (ppError || miError) {
    return NextResponse.json({ error: (ppError ?? miError)?.message }, { status: 500 });
  }

  return NextResponse.json({ partnerPreferences: ppRow, marriageIntentions: miRow });
}
