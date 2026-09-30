import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Aggregate observability only (Phase 17 §22/§26): request counts, provider
// mix, latency, success rate, safety-event TYPE counts. Never message
// content, never which member said what — ai_pastor_messages is never
// queried here.
export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (!profile || !ADMIN_ROLES.includes(profile.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = getAdminClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{ data: usage }, { data: safety }, { data: mediaJobs }] = await Promise.all([
    admin.from("ai_pastor_usage_logs").select("requestType, provider, aiSuccess, retrievalSuccess, usedFallback, latencyMs, createdAt").gte("createdAt", since),
    admin.from("ai_pastor_safety_events").select("eventType, createdAt").gte("createdAt", since).order("createdAt", { ascending: false }).limit(50),
    admin.from("ai_media_generation_jobs").select("mediaType, status, provider, createdAt").gte("createdAt", since),
  ]);

  const rows = usage ?? [];
  const byProvider: Record<string, number> = {};
  const byRequestType: Record<string, number> = {};
  let successCount = 0;
  let fallbackCount = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  for (const r of rows) {
    if (r.provider) byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
    byRequestType[r.requestType] = (byRequestType[r.requestType] ?? 0) + 1;
    if (r.aiSuccess) successCount++;
    if (r.usedFallback) fallbackCount++;
    if (typeof r.latencyMs === "number") {
      totalLatency += r.latencyMs;
      latencyCount++;
    }
  }

  const safetyByType: Record<string, number> = {};
  for (const s of safety ?? []) safetyByType[s.eventType] = (safetyByType[s.eventType] ?? 0) + 1;

  const mediaByTypeAndStatus: Record<string, number> = {};
  for (const m of mediaJobs ?? []) {
    const key = `${m.mediaType}:${m.status}`;
    mediaByTypeAndStatus[key] = (mediaByTypeAndStatus[key] ?? 0) + 1;
  }

  return NextResponse.json({
    windowDays: 7,
    totalRequests: rows.length,
    successRate: rows.length ? Math.round((successCount / rows.length) * 100) : null,
    fallbackUsedCount: fallbackCount,
    avgLatencyMs: latencyCount ? Math.round(totalLatency / latencyCount) : null,
    byProvider,
    byRequestType,
    safety: { total: (safety ?? []).length, byType: safetyByType, recent: (safety ?? []).slice(0, 10) },
    media: mediaByTypeAndStatus,
  });
}
