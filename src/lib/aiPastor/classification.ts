// Question classification (Phase 16 §4/§5 pipeline step). Deliberately
// rule-based, not a second AI call — keeps latency/cost down and keeps this
// step auditable. Coarse by design: it only needs to pick a topic bucket to
// steer Scripture search, not to understand the question fully.

export type PastoralTopic =
  | "MARRIAGE"
  | "WISDOM"
  | "FAITH"
  | "FORGIVENESS"
  | "FAMILY"
  | "BUSINESS_ETHICS"
  | "STEWARDSHIP"
  | "CHARACTER"
  | "LEADERSHIP"
  | "GENERAL";

const TOPIC_KEYWORDS: Record<PastoralTopic, RegExp[]> = {
  MARRIAGE: [/\bmarriage\b/i, /\bspouse\b/i, /\bhusband\b/i, /\bwife\b/i, /\bcourtship\b/i, /\bdating\b/i, /\bmarry\b/i],
  WISDOM: [/\bwisdom\b/i, /\bproverbs?\b/i, /\bdecision\b/i, /\bdiscernment\b/i],
  FAITH: [/\bfaith\b/i, /\bbelief\b/i, /\bdoubt\b/i, /\btrust in god\b/i, /\bprayer\b/i],
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

/** Default search query used to pull candidate Scripture for a topic when the user's own wording is too sparse to search well directly. */
export const TOPIC_SEARCH_TERMS: Record<PastoralTopic, string> = {
  MARRIAGE: "marriage husband wife",
  WISDOM: "wisdom understanding",
  FAITH: "faith trust",
  FORGIVENESS: "forgive forgiveness",
  FAMILY: "family children parents",
  BUSINESS_ETHICS: "honest dealings work",
  STEWARDSHIP: "money wealth giving",
  CHARACTER: "character integrity",
  LEADERSHIP: "leader leadership",
  GENERAL: "",
};
