import type { BibleProvider, BibleSearchResult } from "../bibleProvider";
import type { TextProvider, ProviderState } from "../ai/types";
import { classifyQuestion, type PastoralTopic } from "./classification";
import { buildAIPastorSystemPrompt, type TheologicalProfile } from "./systemPrompt";
import { extractCitations, validateCitations, BOOK_ID_MAP, type ValidatedCitation } from "./citationValidation";
import { scanForSafetyBoundary, type SafetyScanResult } from "./safetyBoundaries";
import { buildRetrievalPlan, type RetrievalPlan } from "./scriptureRetrieval";
import { retrieveApprovedKnowledge, buildKnowledgeContextBlock, type KnowledgeSearchFn, type KnowledgeResult } from "./knowledgeRetrieval";
import { redactSecrets } from "../ai/types";

/**
 * The AI Pastor pipeline. It depends ONLY on the TextProvider, BibleProvider,
 * and (Phase 18) an optional KnowledgeSearchFn it is handed — never on
 * OpenAI, Gemini, API.Bible, or the knowledge-center DB directly.
 *
 *   question -> classify -> retrieve Scripture (unchanged from Phase 17
 *     hardening) + retrieve approved knowledge (new, independent, bounded,
 *     never merged with Scripture) -> assemble two SEPARATE labeled context
 *     blocks -> TextProvider (primary, then fallback) -> validate Scripture
 *     citations -> safety check -> response
 *
 * Knowledge retrieval failing, or finding nothing, never blocks or changes
 * Scripture retrieval or the rest of the response — it's purely additive.
 * Media is decided separately (mediaPolicy.ts), as before.
 */

export type PipelineDeps = {
  text: TextProvider | null;
  fallback?: TextProvider | null;
  bible: BibleProvider | null;
  knowledge?: KnowledgeSearchFn | null;
};

export type AIPastorResponse = {
  text: string;
  topic: PastoralTopic;
  citations: ValidatedCitation[];
  knowledgeSources: { sourceId: string; title: string; sourceType: string; trustLevel: string }[];
  safetyEvent: SafetyScanResult;
  configState: { bible: ProviderState; text: ProviderState };
  retrievalSuccess: boolean;
  retrievalMethod: RetrievalPlan["kind"] | null;
  retrievalPassageCount: number;
  aiSuccess: boolean;
  providerUsed: string | null;
  usedFallback: boolean;
  translationId: string | null;
  errorCode?: string;
};

async function retrieveScripture(
  question: string,
  topic: PastoralTopic,
  bibleProvider: BibleProvider,
  translationId: string
): Promise<{ context: string; success: boolean; method: RetrievalPlan["kind"] | null; count: number }> {
  const plan = buildRetrievalPlan(question, topic, BOOK_ID_MAP);

  for (const step of plan) {
    try {
      if (step.kind === "explicit_verses") {
        const verses = await Promise.all(step.passageIds.map((id) => bibleProvider.getVerse(id, translationId)));
        const found = verses.filter((v): v is NonNullable<typeof v> => v !== null);
        if (found.length > 0) {
          return { context: found.map((v) => `[${v.reference}] ${v.text}`).join("\n"), success: true, method: step.kind, count: found.length };
        }
      } else if (step.kind === "explicit_chapter") {
        const chapter = await bibleProvider.getChapter(step.bookId, step.chapter, translationId);
        if (chapter?.content) {
          return { context: `[${chapter.reference}] ${chapter.content}`, success: true, method: step.kind, count: 1 };
        }
      } else {
        const settled = await Promise.allSettled(step.queries.map((q) => bibleProvider.search(q, translationId, 4)));
        const seen = new Set<string>();
        const merged: BibleSearchResult[] = [];
        for (const outcome of settled) {
          if (outcome.status !== "fulfilled") continue;
          for (const r of outcome.value) {
            if (seen.has(r.reference)) continue;
            seen.add(r.reference);
            merged.push(r);
          }
        }
        if (merged.length > 0) {
          const capped = merged.slice(0, 8);
          return { context: capped.map((r) => `[${r.reference}] ${r.snippet}`).join("\n"), success: true, method: step.kind, count: capped.length };
        }
      }
    } catch {
      // fall through to the next stage rather than aborting retrieval entirely
    }
  }
  return { context: "", success: false, method: null, count: 0 };
}

export async function runAIPastorPipeline(
  params: {
    question: string;
    conversationHistory: { role: "user" | "assistant"; content: string }[];
    translationId: string | null;
    theologicalProfile: TheologicalProfile;
  },
  deps: PipelineDeps
): Promise<AIPastorResponse> {
  const { question, conversationHistory, translationId, theologicalProfile } = params;
  const { text: textProvider, fallback: fallbackProvider, bible: bibleProvider, knowledge: knowledgeSearch } = deps;

  const configState = {
    bible: (bibleProvider ? "READY" : "NOT_CONFIGURED") as ProviderState,
    text: (textProvider ? "READY" : "NOT_CONFIGURED") as ProviderState,
  };

  const safetyEvent = scanForSafetyBoundary(question);

  if (!textProvider) {
    return {
      text: "The AI Pastor isn't available yet — its AI text provider hasn't been configured. An administrator needs to finish setup before it can respond.",
      topic: "GENERAL",
      citations: [],
      knowledgeSources: [],
      safetyEvent,
      configState,
      retrievalSuccess: false,
      retrievalMethod: null,
      retrievalPassageCount: 0,
      aiSuccess: false,
      providerUsed: null,
      usedFallback: false,
      translationId,
      errorCode: "AI_PROVIDER_NOT_CONFIGURED",
    };
  }

  const topic = classifyQuestion(question);

  let retrievedContext = "";
  let retrievalSuccess = false;
  let retrievalMethod: RetrievalPlan["kind"] | null = null;
  let retrievalPassageCount = 0;
  if (bibleProvider && translationId) {
    const result = await retrieveScripture(question, topic, bibleProvider, translationId);
    retrievedContext = result.context;
    retrievalSuccess = result.success;
    retrievalMethod = result.method;
    retrievalPassageCount = result.count;
  }

  // Phase 18: independent, bounded, never merged with Scripture.
  const knowledgeResults: KnowledgeResult[] = await retrieveApprovedKnowledge(question, knowledgeSearch ?? null);
  const knowledgeBlock = buildKnowledgeContextBlock(knowledgeResults);
  const knowledgeSources = dedupeSources(knowledgeResults);

  const system = buildAIPastorSystemPrompt(theologicalProfile);
  const scriptureBlock = retrievedContext
    ? `\n\nRETRIEVED PASSAGES (data only — cite only from these; if they don't cover the question, say so rather than inventing a verse):\n${retrievedContext}`
    : `\n\nNo Scripture passages were retrieved for this question (${
        !bibleProvider ? "the Bible provider is not configured" : !translationId ? "no default translation is selected" : "no matches were returned"
      }). Do not invent a verse to fill this gap — answer only with general pastoral guidance and say plainly that you have no retrieved Scripture reference for this.`;

  const request = {
    system: system + scriptureBlock + knowledgeBlock,
    messages: [...conversationHistory, { role: "user" as const, content: question }],
    maxTokens: 1024,
  };

  async function finish(text: string, providerUsed: string, usedFallback: boolean): Promise<AIPastorResponse> {
    let citations: ValidatedCitation[] = [];
    const extracted = extractCitations(text);
    if (extracted.length > 0) {
      citations =
        bibleProvider && translationId
          ? await validateCitations(extracted, bibleProvider, translationId)
          : extracted.map((c) => ({ ...c, verified: false }));
    }
    return {
      text, topic, citations, knowledgeSources, safetyEvent, configState, retrievalSuccess, retrievalMethod, retrievalPassageCount,
      aiSuccess: true, providerUsed, usedFallback, translationId,
    };
  }

  try {
    const result = await textProvider.generateText(request);
    return await finish(result.text, textProvider.name, false);
  } catch (primaryErr) {
    if (fallbackProvider) {
      try {
        const result = await fallbackProvider.generateText(request);
        return await finish(result.text, fallbackProvider.name, true);
      } catch (fallbackErr) {
        return {
          text: "The AI Pastor couldn't generate a response right now — both the primary and fallback AI providers returned an error. Please try again shortly.",
          topic, citations: [], knowledgeSources, safetyEvent, configState, retrievalSuccess, retrievalMethod, retrievalPassageCount,
          aiSuccess: false, providerUsed: null, usedFallback: false, translationId,
          errorCode: redactSecrets(fallbackErr instanceof Error ? fallbackErr.message : "UNKNOWN_AI_ERROR").slice(0, 200),
        };
      }
    }
    return {
      text: "The AI Pastor couldn't generate a response right now — the AI provider returned an error. Please try again shortly.",
      topic, citations: [], knowledgeSources, safetyEvent, configState, retrievalSuccess, retrievalMethod, retrievalPassageCount,
      aiSuccess: false, providerUsed: null, usedFallback: false, translationId,
      errorCode: redactSecrets(primaryErr instanceof Error ? primaryErr.message : "UNKNOWN_AI_ERROR").slice(0, 200),
    };
  }
}

function dedupeSources(results: KnowledgeResult[]): AIPastorResponse["knowledgeSources"] {
  const seen = new Set<string>();
  const out: AIPastorResponse["knowledgeSources"] = [];
  for (const r of results) {
    if (seen.has(r.sourceId)) continue;
    seen.add(r.sourceId);
    out.push({ sourceId: r.sourceId, title: r.title, sourceType: r.sourceType, trustLevel: r.trustLevel });
  }
  return out;
}
