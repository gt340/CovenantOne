"use client";

import { createBrowserClient } from "@supabase/ssr";

// Anon key only — every request through this client is subject to RLS.
// Never import the service role key here; this file may end up in a
// client-side bundle.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
