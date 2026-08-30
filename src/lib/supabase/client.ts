"use client";

import { createBrowserClient } from "@supabase/ssr";

// Anon key only — every request through this client is subject to RLS.
// Never import the service role key here; this file may end up in a
// client-side bundle.
//
// `experimental.passkey: true` opts into Supabase's WebAuthn/passkey API
// (beta as of the Supabase changelog dated 2026-05-28 — requires
// @supabase/supabase-js v2.105.0+). Passkey ceremonies (navigator.credentials)
// only ever run in the browser, so this flag is deliberately not set on the
// server client in server.ts.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        experimental: { passkey: true },
      },
    }
  );
}
