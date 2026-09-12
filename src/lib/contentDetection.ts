/**
 * CONTENT DETECTION — what this actually is
 * =============================================================
 * This is a keyword/pattern heuristic scanner, NOT a trained AI or ML
 * model. Calling it "AI-assisted" in the product sense is fair (it's
 * automated pre-screening that assists human moderators), but it would
 * be dishonest to claim it understands language, intent, or context —
 * it does simple substring and regex matching against known terms and
 * patterns, nothing more.
 *
 * This intentionally matches the spec's real requirement: automated
 * detection is a FLAGGING system only. A match here NEVER creates a
 * moderator_actions row, NEVER changes a user's status, and NEVER
 * closes or resolves anything by itself — it only inserts a row into
 * content_flags with status PENDING_REVIEW, which a human
 * SAFETY_MODERATOR-tier reviewer must explicitly confirm or dismiss
 * before anything else happens (see /api/moderation/flags/[id]).
 *
 * UPGRADE PATH: to replace this with genuine AI-assisted detection,
 * swap the body of `scanText()` for a call to a real content-moderation
 * model — e.g. an LLM classification call (Anthropic/OpenAI moderation
 * endpoints) or a purpose-built trust & safety API (Hive, ActiveFence,
 * Thorn). Keep the same return shape (matches: {category, confidence,
 * matchedTerms}[]) and every caller of this module keeps working
 * unchanged — the human-review requirement above the detector doesn't
 * change either way.
 */

export interface DetectionMatch {
  category: string; // a ReportReasonCategory value
  confidence: number; // 0..1 — heuristic, not a calibrated probability
  matchedTerms: string[];
}

// Deliberately coarse, low-precision patterns — this is a pre-filter to
// surface things for human review, not a judgment. False positives are
// expected and fine; false negatives are expected too, since this is
// not exhaustive. Terms are lowercase; matching is case-insensitive.
const PATTERNS: { category: string; confidence: number; terms: string[] }[] = [
  {
    category: "SEXUAL_SOLICITATION",
    confidence: 0.6,
    terms: ["send nudes", "nude pic", "sext", "hook up tonight", "no strings attached"],
  },
  {
    category: "PROSTITUTION_OR_SEXUAL_SERVICES",
    confidence: 0.6,
    terms: ["pay for sex", "escort service", "$ for a night", "cash for company"],
  },
  {
    category: "SCAM_OR_FINANCIAL",
    confidence: 0.55,
    terms: ["wire transfer", "gift card codes", "send bitcoin", "western union", "investment opportunity guaranteed", "crypto wallet"],
  },
  {
    category: "FRAUD",
    confidence: 0.5,
    terms: ["bank account details", "routing number", "social security number", "ssn"],
  },
  {
    category: "THREAT",
    confidence: 0.7,
    terms: ["i will hurt you", "i know where you live", "you'll regret", "watch your back"],
  },
  {
    category: "HARASSMENT",
    confidence: 0.45,
    terms: ["leave me alone", "stop messaging me", "stop contacting me"],
  },
  {
    category: "UNSAFE_MEETING_PRESSURE",
    confidence: 0.5,
    terms: ["come to my place tonight", "meet me alone at", "don't tell anyone we're meeting"],
  },
  {
    category: "UNDERAGE_CONCERN",
    confidence: 0.75,
    terms: ["i'm only 15", "i'm only 16", "i'm only 17", "still in high school"],
  },
];

export function scanText(text: string): DetectionMatch[] {
  const lower = text.toLowerCase();
  const matches: DetectionMatch[] = [];

  for (const pattern of PATTERNS) {
    const found = pattern.terms.filter((term) => lower.includes(term));
    if (found.length > 0) {
      matches.push({
        category: pattern.category,
        // Slightly boost confidence when multiple distinct terms match,
        // capped at 0.9 — never full confidence, since this is a heuristic.
        confidence: Math.min(0.9, pattern.confidence + (found.length - 1) * 0.1),
        matchedTerms: found,
      });
    }
  }

  return matches;
}
