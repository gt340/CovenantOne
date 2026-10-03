export type PastoralTopic = "MARRIAGE" | "WISDOM" | "FAITH" | "FORGIVENESS" | "FAMILY" | "BUSINESS_ETHICS" | "STEWARDSHIP" | "CHARACTER" | "LEADERSHIP" | "GENERAL";

// FAITH's keyword list is intentionally broader than the others (Phase 17
// topic-retrieval hardening): "trusting God in hard times" is one of the
// most common ways members will actually phrase a question, and it has no
// single-word trigger the way "forgiveness" or "marriage" do. Each pattern
// below maps to a required real-world phrasing, not speculative coverage —
// see the regression tests for the exact question each one exists for.
const TOPIC_KEYWORDS: Record<PastoralTopic, RegExp[]> = {
  MARRIAGE: [/\bmarriage\b/i, /\bspouse\b/i, /\bhusband\b/i, /\bwife\b/i, /\bcourtship\b/i, /\bdating\b/i, /\bmarry\b/i],
  WISDOM: [/\bwisdom\b/i, /\bproverbs?\b/i, /\bdecision\b/i, /\bdiscernment\b/i],
  FAITH: [
    /\bfaith\b/i, /\bbelief\b/i, /\bdoubt\b/i, /\bprayer\b/i,
    /\btrust(ing)?\s+(in\s+)?god\b/i,          // "trust God" / "trusting God" / "trust in God"
    /\btrials?\b/i, /\bhardship\b/i, /\bsuffering\b/i,
    /\banxiety\b/i, /\bfear\b/i, /\bhope\b/i,
  ],
  FORGIVENESS: [/\bforgive/i, /\breconcil/i, /\bgrudge\b/i, /\bhurt me\b/i],
  FAMILY: [/\bfamily\b/i, /\bparent/i, /\bchildren\b/i, /\bin-?laws?\b/i],
  BUSINESS_ETHICS: [/\bbusiness\b/i, /\bhonesty in\b/i, /\bwork ethic\b/i, /\bcareer\b/i],
  STEWARDSHIP: [/\bmoney\b/i, /\bfinances?\b/i, /\btithe\b/i, /\bwealth\b/i, /\bsteward/i, /\bgiving\b/i],
  CHARACTER: [/\bcharacter\b/i, /\bintegrity\b/i, /\bhumility\b/i, /\bpatience\b/i],
  LEADERSHIP: [/\bleadership\b/i, /\bleading\b/i, /\bauthority\b/i],
  GENERAL: [],
};

export function classifyQuestion(question: string): PastoralTopic {
  for (const [topic, patterns] of Object.entries(TOPIC_KEYWORDS)) {
    if (topic === "GENERAL") continue;
    if (patterns.some((p) => p.test(question))) return topic as PastoralTopic;
  }
  return "GENERAL";
}

// Multiple curated search CONCEPTS per topic (Phase 17 topic-retrieval
// hardening), not one canned phrase — API.Bible's search is lexical, so one
// query covers only the verses using those exact words. Each concept is run
// as its own query (bounded, see scriptureRetrieval.ts's MAX_SEARCH_QUERIES)
// and results are merged/deduplicated, not tried one-at-a-time until one
// works. Bounded at 2-4 per topic on purpose — this is curated, not an
// attempt to enumerate every synonym.
export const TOPIC_SEARCH_CONCEPTS: Record<PastoralTopic, string[]> = {
  MARRIAGE: ["marriage", "husband wife", "love one another"],
  WISDOM: ["wisdom", "understanding", "counsel"],
  FAITH: ["faith", "trust in the Lord", "fear not", "hope"],
  FORGIVENESS: ["forgive", "forgiveness", "reconcile"],
  FAMILY: ["family", "children", "parents"],
  BUSINESS_ETHICS: ["honest", "just weights", "labor"],
  STEWARDSHIP: ["money", "giving", "steward"],
  CHARACTER: ["character", "integrity", "patience"],
  LEADERSHIP: ["leader", "shepherd", "authority"],
  GENERAL: [], // no curated concepts — GENERAL falls back to the keyword query alone (see known limitation in the report)
};
