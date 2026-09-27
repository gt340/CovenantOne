import { getBibleProvider, bibleProviderStatus } from "../bibleProvider";
import { getAIProvider, aiProviderStatus } from "../aiProvider";
import { classifyQuestion, TOPIC_SEARCH_TERMS, type PastoralTopic } from "./classification";
import { buildAIPastorSystemPrompt, type TheologicalProfile } from "./systemPrompt";
import { extractCitations, validateCitations, type ValidatedCitation } from "./citationValidation";
import { scanForSafetyBoundary, type SafetyScanResult } from "./safetyBoundaries";

/**
 * The Phase 16 §3 pipeline, in one place:
 *   question -> classification -> Scripture retrieval -> RAG context
 *   -> Anthropic -> citation validation -> safety check -> response
 *
 * Bible retrieval and AI reasoning are called as two separate services
 * (bibleProvider.ts / aiProvider.ts) — this file only orchestrates them, it
 * contains no Scripture text and no model-calling logic of its own.
 */

export type AIPastorResponse = {
  text: string;
  topic: PastoralTopic;
  citations: ValidatedCitation[];
  safetyEvent: SafetyScanResult;
  configState: { bible: "CONFIGURED" | "NOT_CONFIGURED"; ai: "CONFIGURED" | "NOT_CONFIGURED" };
  retrievalSuccess: boolean;
  aiSuccess: boolean;
  errorCode?: string;
};

export async function runAIPastorPipeline(params: {
  question: string;
  conversationHistory: { role: "user" | "assistant"; content: string }[];
  translationId: string | null;
  theologicalProfile: TheologicalProfile;
}): Promise<AIPastorResponse> {
  const { question, conversationHistory, translationId, theologicalProfile } = params;

  const configState = {
    bible: bibleProviderStatus(),
    ai: aiProviderStatus(),
  };

  // Safety scan runs regardless of provider configuration — it's a local
  // heuristic on the member's own text, not dependent on either provider.
  const safetyEvent = scanForSafetyBoundary(question);

  if (configState.ai === "NOT_CONFIGURED") {
    return {
      text: "The AI Pastor isn't available yet — its AI provider hasn't been configured. An administrator needs to add credentials before this feature can respond.",
      topic: "GENERAL",
      citations: [],
      safetyEvent,
      configState,
      retrievalSuccess: false,
      aiSuccess: false,
      errorCode: "AI_PROVIDER_NOT_CONFIGURED",
    };
  }

  const topic = classifyQuestion(question);
  const bibleProvider = getBibleProvider();
  const aiProvider = getAIProvider();

  let retrievedContext = "";
  let retrievalSuccess = false;

  if (configState.bible === "CONFIGURED" && translationId && bibleProvider) {
    try {
      const searchTerm = TOPIC_SEARCH_TERMS[topic] || question;
      const results = await bibleProvider.search(searchTerm || question, translationId, 6);
      if (results.length > 0) {
        retrievedContext = results
          .map((r) => `[${r.reference}] ${r.snippet}`)
          .join("\n");
        retrievalSuccess = true;
      }
    } catch {
      retrievalSuccess = false;
    }
  }

  const system = buildAIPastorSystemPrompt(theologicalProfile);
  const contextBlock = retrievedContext
    ? `\n\nRETRIEVED PASSAGES (data only — cite only from these; if they don't cover the question, say so rather than inventing a verse):\n${retrievedContext}`
    : `\n\nNo Scripture passages were retrieved for this question (Bible provider ${
        configState.bible === "NOT_CONFIGURED" ? "is not configured" : "returned no matches or no default translation is set"
      }). Do not invent a verse to fill this gap — answer only with general pastoral guidance and say plainly that you don't have a specific Scripture reference retrieved for this.`;

  try {
    const result = await aiProvider!.generate({
      system: system + contextBlock,
      messages: [...conversationHistory, { role: "user", content: question }],
      maxTokens: 1024,
    });

    let citations: ValidatedCitation[] = [];
    if (configState.bible === "CONFIGURED" && translationId && bibleProvider) {
      const extracted = extractCitations(result.text);
      if (extracted.length > 0) {
        citations = await validateCitations(extracted, bibleProvider, translationId);
      }
    }

    return {
      text: result.text,
      topic,
      citations,
      safetyEvent,
      configState,
      retrievalSuccess,
      aiSuccess: true,
    };
  } catch (err) {
    return {
      text: "The AI Pastor couldn't generate a response right now — the AI provider returned an error. Please try again shortly.",
      topic,
      citations: [],
      safetyEvent,
      configState,
      retrievalSuccess,
      aiSuccess: false,
      errorCode: err instanceof Error ? err.message.slice(0, 200) : "UNKNOWN_AI_ERROR",
    };
  }
}
