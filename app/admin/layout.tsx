import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // No-op: layouts are read-only for cookies, session refresh is
          // handled by middleware if you have it, otherwise on the client.
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/members");
  }

  const { data: profile, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || !profile || !ADMIN_ROLES.includes(profile.role)) {
    redirect("/");
  }

  return <>{children}</>;
}
