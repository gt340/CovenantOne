import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { runAIPastorPipeline } from "@/lib/aiPastor/ragPipeline";
import { describeAll, getTextProvider } from "@/lib/ai/registry";
import { getBibleProvider } from "@/lib/bibleProvider";
import { decideMedia, type MediaMode } from "@/lib/aiPastor/mediaPolicy";
import { enforceRateLimit, parseLimits } from "@/lib/aiPastor/rateLimit";

const MAX_MESSAGE_CHARS = 2000; // input-size cap: bounds the cost of any single request

async function getAuthedClientAndUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// POST { conversationId?, message } -> full pipeline. Order matters:
//   auth -> validate -> RATE LIMIT (server-side, before any provider spend)
//   -> ownership check -> pipeline -> persist -> media decision -> logging.
// Text generation never waits on, or depends on, image/video: the media
// decision is returned for the client to act on via /api/ai-pastor/media,
// which enforces its own (stricter) limits.
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { conversationId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `message must be ${MAX_MESSAGE_CHARS} characters or fewer` }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: settings } = await supabase.from("ai_pastor_settings").select("*").eq("id", true).single();

  const limit = await enforceRateLimit(admin, user.id, "TEXT", parseLimits(settings?.rateLimits));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again shortly.", reason: limit.reason, retryAfterSeconds: limit.retryAfterSeconds },
      { status: limit.reason === "LIMITER_UNAVAILABLE" ? 503 : 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  // Load (and verify ownership of) or create the conversation.
  let conversationId = body.conversationId;
  if (conversationId) {
    const { data: owned } = await supabase.from("ai_pastor_conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!owned) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  } else {
    const { data: conv, error } = await supabase
      .from("ai_pastor_conversations")
      .insert({ userId: user.id, title: message.slice(0, 60) })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    conversationId = conv.id;
  }

  // Short window of prior turns — not an unbounded transcript dump.
  const { data: priorMessages } = await supabase
    .from("ai_pastor_messages")
    .select("role, content")
    .eq("conversationId", conversationId)
    .order("createdAt", { ascending: true })
    .limit(20);

  const history = (priorMessages ?? []).map((m: any) => ({
    role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));

  const result = await runAIPastorPipeline(
    {
      question: message,
      conversationHistory: history,
      translationId: settings?.bibleDefaultTranslationId ?? null,
      theologicalProfile: settings?.theologicalProfile ?? null,
    },
    { text: getTextProvider(settings), bible: getBibleProvider() }
  );

  await supabase.from("ai_pastor_messages").insert({ conversationId, role: "USER", content: message });
  const { data: assistantRow } = await supabase
    .from("ai_pastor_messages")
    .insert({ conversationId, role: "ASSISTANT", content: result.text, classification: result.topic, scriptureRefs: result.citations })
    .select("id")
    .single();
  await supabase.from("ai_pastor_conversations").update({ updatedAt: new Date().toISOString() }).eq("id", conversationId);

  // Media is a separate, optional, policy-gated concern.
  const providers = describeAll(settings);
  const { data: account } = await supabase.from("users").select("status").eq("id", user.id).maybeSingle();
  const mediaDecision = decideMedia({
    message,
    topic: result.topic,
    mode: (settings?.mediaMode ?? "OFF") as MediaMode,
    imageReady: providers.image.state === "READY",
    videoReady: providers.video.state === "READY",
    safetyTriggered: result.safetyEvent.triggered,
    accountActive: account?.status === "ACTIVE",
  });

  // Best-effort logging — never let logging failures affect the response.
  try {
    await admin.from("ai_pastor_usage_logs").insert({
      userId: user.id,
      requestType: "CHAT",
      latencyMs: Date.now() - startedAt,
      retrievalSuccess: result.retrievalSuccess,
      aiSuccess: result.aiSuccess,
      errorCode: result.errorCode ?? null,
    });
    if (result.safetyEvent.triggered) {
      await admin.from("ai_pastor_safety_events").insert({
        userId: user.id,
        conversationId,
        messageId: assistantRow?.id ?? null,
        eventType: result.safetyEvent.type,
        detail: "Heuristic safety boundary triggered on member message.",
      });
    }
  } catch {
    // logging is advisory
  }

  return NextResponse.json({
    conversationId,
    messageId: assistantRow?.id ?? null,
    response: result.text,
    topic: result.topic,
    citations: result.citations,
    safetyNote: result.safetyEvent.triggered ? result.safetyEvent.note : null,
    configState: result.configState,
    mediaDecision,
  });
}
