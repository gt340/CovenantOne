import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Required for @supabase/ssr session handling in Next.js: access tokens are
// short-lived, and this is what silently refreshes the cookie-stored session
// on every request so a signed-in user doesn't get logged out mid-session.
// Without this, cookies set in a Server Component (which can't write
// cookies — see the try/catch note in src/lib/supabase/server.ts) would
// never actually persist a refreshed token.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // The act of calling getUser() is what triggers the refresh-if-needed
  // logic inside @supabase/ssr — the return value isn't used here, but the
  // side effect (writing refreshed cookies onto `response`) is the point.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets and the Next.js internals,
     * which never need session refresh.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
