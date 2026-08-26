import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Anon key + the caller's own session cookie. Every request through this
// client acts AS the signed-in user and is subject to RLS exactly like the
// browser client — this is not a privilege escalation, just a cookie-aware
// variant for server-side rendering and Route Handlers.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component rather than a Route Handler or
            // Server Action — cookies can't be set there. Safe to ignore as
            // long as middleware (not yet built) refreshes sessions; noted
            // as a follow-up rather than silently assumed solved.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // See note above.
          }
        },
      },
    }
  );
}
