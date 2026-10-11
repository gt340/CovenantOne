import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { runAIPastorPipeline } from "@/lib/aiPastor/ragPipeline";
import { getBibleProvider } from "@/lib/bibleProvider";
import type { TextProvider } from "@/lib/ai/types";
import { createKnowledgeSearch, hashQuestion, summarizeSelected, type CapturedKnowledge } from "@/lib/aiPastor/knowledgeSearchDb";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const MAX_QUESTION_CHARS = 500;
const PREVIEW_CHARS = 300;

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireAdmin() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (!profile || !ADMIN_ROLES.includes(profile.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user, supabase };
}

function exclusionReason(s: { approvalStatus: string; isCurrentProduction: boolean; archivedAt: string | null; licenseStatus: string; visibility: string }): string | null {
  if (s.approvalStatus !== "APPROVED") return `approvalStatus is ${s.approvalStatus}`;
  if (!s.isCurrentProduction) return "superseded — not the current production version";
  if (s.archivedAt) return "archived";
  if (["LICENSE_UNKNOWN", "LICENSE_REQUIRES_REVIEW", "RESTRICTED"].includes(s.licenseStatus)) return `licence ${s.licenseStatus} blocks production use`;
  if (s.visibility !== "MEMBER_FACING") return `visibility is ${s.visibility} (not served to members)`;
  return null;
}

// POST { question } — admin-only retrieval debugger. Runs the REAL pipeline
// with a stub text provider that records the assembled context and returns
// empty text: no AI provider call, no cost, and what you see is exactly the
// context a member's question would produce. Never returns secrets, env
// values or full documents (previews are truncated).
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: { question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) return NextResponse.json({ error: `question must be ${MAX_QUESTION_CHARS} characters or fewer` }, { status: 400 });

  const admin = getAdminClient();
  const { data: settings } = await admin.from("ai_pastor_settings").select('"bibleDefaultTranslationId", "theologicalProfile"').eq("id", true).single();

  let capturedSystem: string | null = null;
  const stub = {
    name: "retrieval-console-stub",
    generateText: async (req: { system: string }) => {
      capturedSystem = req.system;
      return { text: "" };
    },
  } as unknown as TextProvider;

  const captured: CapturedKnowledge[] = [];
  const knowledgeError: string[] = [];
  const baseSearch = createKnowledgeSearch(admin, { capture: captured });
  const knowledge = async (q: string, limit?: number) => {
    try {
      return await baseSearch(q, limit);
    } catch (e) {
      knowledgeError.push(e instanceof Error ? e.message : "unknown error");
      throw e;
    }
  };

  const result = await runAIPastorPipeline(
    { question, conversationHistory: [], translationId: settings?.bibleDefaultTranslationId ?? null, theologicalProfile: settings?.theologicalProfile ?? null },
    { text: stub, fallback: null, bible: getBibleProvider(), knowledge }
  );

  // Candidates the full-text query matched regardless of status, each with
  // the reason it was or wasn't eligible. Bounded to 20 rows.
  const { data: candidates } = await admin
    .from("knowledge_chunks")
    .select('id, "chunkIndex", content, knowledge_sources!inner(id, title, version, "sourceType", "approvalStatus", "isCurrentProduction", "archivedAt", "licenseStatus", visibility, "trustLevel")')
    .textSearch("contentTsv", question, { type: "plain", config: "english" })
    .limit(20);

  const considered = (candidates ?? []).map((c: any) => {
    const s = c.knowledge_sources;
    const reason = exclusionReason(s);
    return {
      chunkId: c.id, chunkIndex: c.chunkIndex, sourceId: s.id, title: s.title, version: s.version, sourceType: s.sourceType,
      trustLevel: s.trustLevel, approvalStatus: s.approvalStatus, licenseStatus: s.licenseStatus, visibility: s.visibility,
      eligible: reason === null, excludedBecause: reason,
      preview: c.content.length > PREVIEW_CHARS ? c.content.slice(0, PREVIEW_CHARS) + "…" : c.content,
    };
  });

  const selected = summarizeSelected(captured);
  await admin.from("ai_pastor_retrieval_events").insert({
    userId: auth.user.id, origin: "ADMIN_TEST", questionHash: hashQuestion(question), questionText: question, topic: result.topic,
    consideredCount: considered.length, selected,
  });
  await admin.from("audit_logs").insert({
    actorUserId: auth.user.id, action: "KNOWLEDGE_RETRIEVAL_TEST_RUN", targetType: "ai_pastor_retrieval_events", metadata: { questionHash: hashQuestion(question) },
  });

  // Strip the base system prompt: show only the retrieved-context blocks.
  const ctxStart = capturedSystem ? (capturedSystem as string).indexOf("\n\nRETRIEVED PASSAGES") : -1;
  const ctxStartAlt = capturedSystem ? (capturedSystem as string).indexOf("\n\nNo Scripture passages were retrieved") : -1;
  const start = [ctxStart, ctxStartAlt].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const finalContext = capturedSystem && start !== undefined ? (capturedSystem as string).slice(start) : null;

  return NextResponse.json({
    classification: result.topic,
    safety: result.safetyEvent,
    providers: result.configState,
    scripture: {
      translationId: result.translationId,
      retrievalSuccess: result.retrievalSuccess,
      method: result.retrievalMethod,
      passageCount: result.retrievalPassageCount,
    },
    knowledge: {
      consideredCount: considered.length,
      considered,
      selected,
      sourcesInAnswerContext: result.knowledgeSources,
      failures: knowledgeError,
    },
    finalContext,
  });
}
