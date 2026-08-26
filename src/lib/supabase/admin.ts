import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// SERVICE ROLE KEY — bypasses RLS entirely. The `server-only` import above
// makes it a build error to accidentally import this file from client code.
//
// Legitimate uses in this codebase are narrow and specific:
//   - Creating auth.users rows on behalf of the user during signup flows
//     that need it (none currently — normal signup goes through the
//     browser client's own supabase.auth.signUp)
//   - prisma/seed.ts, for provisioning dev-only seed accounts
//   - Account deletion (app/api/account/delete) — see that route for why
//     an admin-level action is the correct tool there
//
// Every other operation in this app should go through the anon-key clients
// (client.ts / server.ts) so RLS actually does its job. Reach for this file
// only when the operation is genuinely privileged, not for convenience.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — admin client cannot be created."
    );
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
