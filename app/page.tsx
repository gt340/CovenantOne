import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// The real landing point. Was left as the original Phase 1 infrastructure
// check page — everyone hitting the bare domain saw that instead of the
// actual product. Signed-in visitors go to onboarding (which itself knows
// whether they're mid-flow or fully set up); everyone else goes to login.
export default async function Home() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();

  redirect(user ? "/onboarding" : "/login");
}
