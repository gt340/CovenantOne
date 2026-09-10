import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { runDiscoverySearch } from "@/lib/discovery";

async function getAuthedUser() {
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
  return user;
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const result = await runDiscoverySearch(authedUser.id, {
    page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1),
    pageSize: Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20)),
    nameSearch: searchParams.get("search")?.trim().toLowerCase() || undefined,
    interestFilter: searchParams.get("interests")?.split(",").filter(Boolean),
    countryFilter: searchParams.get("country")?.trim() || undefined,
    ageMinOverride: searchParams.get("ageMin") ? Number(searchParams.get("ageMin")) : undefined,
    ageMaxOverride: searchParams.get("ageMax") ? Number(searchParams.get("ageMax")) : undefined,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: result.error.status });
  }
  return NextResponse.json(result.body);
}
