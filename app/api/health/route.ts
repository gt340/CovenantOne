import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Forces this route to run at request time, never statically cached — a
// health check that's cached at build time would always report success even
// if env vars or connectivity break later.
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      {
        ok: false,
        stage: "env",
        error:
          "NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are not set in this environment.",
      },
      { status: 500 }
    );
  }

  const supabase = createClient(url, anonKey);

  // Query a real table from the live schema. Under RLS, an unauthenticated
  // (anon-role) request to `interests` returns an empty result rather than a
  // hard error — that's expected and still proves the request reached
  // Supabase with valid credentials. A wrong/invalid key surfaces as a real
  // `error` here instead.
  const { error, status } = await supabase
    .from("interests")
    .select("id")
    .limit(1);

  if (error) {
    return NextResponse.json(
      { ok: false, stage: "query", error: error.message, status },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Reached Supabase successfully using the configured env vars.",
    tableChecked: "interests",
    note: "An empty result here is expected and correct — RLS intentionally hides this table's contents from unauthenticated requests. The point of this check is that the request succeeded at all.",
  });
}
