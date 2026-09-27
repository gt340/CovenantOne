import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { runAIPastorPipeline } from "@/lib/aiPastor/ragPipeline";

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

// POST { conversationId?, message } -> runs the full RAG pipeline. Creates a
// conversation on first message. Never crashes on missing credentials — see
// runAIPastorPipeline's NOT_CONFIGURED handling. Logs to
// ai_pastor_usage_logs (aggregate only, no message content) and
// ai_pastor_safety_events (only when the safety scanner actually triggers).
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
  if (!body.message?.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const admin = getAdminClient();

  // Load or create the conversation.
  let conversationId = body.conversationId;
  if (!conversationId) {
    const { data: conv, error } = await supabase
      .from("ai_pastor_conversations")
      .insert({ userId: user.id, title: body.message.trim().slice(0, 60) })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    conversationId = conv.id;
  }

  // Prior turns for context (short window — this is not an unbounded transcript dump, Phase 16 §14).
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

  const { data: settings } = await supabase.from("ai_pastor_settings").select("*").eq("id", true).single();

  const result = await runAIPastorPipeline({
    question: body.message.trim(),
    conversationHistory: history,
    translationId: settings?.bibleDefaultTranslationId ?? null,
    theologicalProfile: settings?.theologicalProfile ?? null,
  });

  // Persist both turns.
  await supabase.from("ai_pastor_messages").insert({
    conversationId,
    role: "USER",
    content: body.message.trim(),
  });
  await supabase.from("ai_pastor_messages").insert({
    conversationId,
    role: "ASSISTANT",
    content: result.text,
    classification: result.topic,
    scriptureRefs: result.citations,
  });
  await supabase.from("ai_pastor_conversations").update({ updatedAt: new Date().toISOString() }).eq("id", conversationId);

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
        eventType: result.safetyEvent.type,
        detail: "Heuristic safety boundary triggered on member message.",
      });
    }
  } catch {
    // logging is advisory
  }

  return NextResponse.json({
    conversationId,
    response: result.text,
    topic: result.topic,
    citations: result.citations,
    safetyNote: result.safetyEvent.triggered ? result.safetyEvent.note : null,
    configState: result.configState,
  });
}
