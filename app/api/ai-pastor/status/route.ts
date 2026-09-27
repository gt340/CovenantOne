import { NextResponse } from "next/server";
import { bibleProviderStatus } from "@/lib/bibleProvider";
import { aiProviderStatus } from "@/lib/aiProvider";

// Public-to-any-authenticated-member status check — lets the chat UI show
// a clear "not configured yet" state instead of a confusing failure.
// Detailed connection health (a live network call) is admin-only, see
// /api/admin/ai-pastor/health.
export async function GET() {
  return NextResponse.json({
    bibleProvider: bibleProviderStatus(),
    aiProvider: aiProviderStatus(),
  });
}
