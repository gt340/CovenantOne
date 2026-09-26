// Lightweight, deterministic pattern heuristic for flagging potentially
// problematic content (Phase 14 §2 Safety Assistant + §5 Community
// Moderation). Deliberately NOT an LLM call: a fixed, auditable rule set
// that never fabricates a judgment and can't be prompt-injected by the
// text it's scanning. See AI_ASSISTANCE_POLICY.md at the repo root.
//
// This function only ever SUGGESTS a flag for a human moderator to review
// (writes to the existing content_flags table, status PENDING_REVIEW). It
// must never trigger removal, suspension, or any other enforcement action
// on its own — see app/api/admin/safety-flags for the human-review boundary.

export type FlagCategory = "HARASSMENT" | "SEXUAL_SOLICITATION" | "SCAM_OR_FINANCIAL" | "THREAT" | "COERCION";

export type HeuristicResult = {
  category: FlagCategory;
  confidenceScore: number; // 0-1, deliberately coarse — a triage signal, not a verdict
  matchedTerms: string[]; // short pattern labels only, never the full quoted text
} | null;

const RULES: { category: FlagCategory; confidence: number; patterns: RegExp[] }[] = [
  {
    category: "SCAM_OR_FINANCIAL",
    confidence: 0.6,
    patterns: [
      /\bwire\s?transfer\b/i,
      /\bwestern\s?union\b/i,
      /\bgift\s?cards?\b.{0,20}\b(code|number)\b/i,
      /\bsend\s+(me\s+)?(money|cash|\$)/i,
      /\binvest(ment)?\s+opportunit(y|ies)\b/i,
      /\bcrypto(currency)?\s+(investment|trading)\b/i,
      /\bbitcoin\b.{0,20}\b(send|invest|double)\b/i,
    ],
  },
  {
    category: "THREAT",
    confidence: 0.75,
    patterns: [/\bi('| a)?ll\s+(kill|hurt|find)\s+you\b/i, /\byou('| a)?ll\s+regret\b/i, /\bwatch\s+your\s+back\b/i],
  },
  {
    category: "HARASSMENT",
    confidence: 0.5,
    patterns: [/\bshut\s+up\b.{0,15}\b(idiot|stupid|worthless)\b/i, /\byou\s+are\s+(worthless|pathetic|disgusting)\b/i],
  },
  {
    category: "SEXUAL_SOLICITATION",
    confidence: 0.65,
    patterns: [/\bnudes?\b/i, /\bsex\s?cam\b/i, /\bonlyfans\b/i, /\bsugar\s?(daddy|baby)\b/i],
  },
  {
    category: "COERCION",
    confidence: 0.55,
    patterns: [/\bif\s+you\s+don'?t\b.{0,25}\b(i('ll)?|i will)\b/i, /\bmarry\s+me\s+or\b/i],
  },
];

export function scanText(text: string | null | undefined): HeuristicResult {
  if (!text || text.trim().length < 3) return null;

  let best: { category: FlagCategory; confidence: number; matched: string[] } | null = null;
  for (const rule of RULES) {
    const matched: string[] = [];
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) matched.push(pattern.source.slice(0, 40));
    }
    if (matched.length > 0) {
      const confidence = Math.min(0.95, rule.confidence + (matched.length - 1) * 0.1);
      if (!best || confidence > best.confidence) {
        best = { category: rule.category, confidence, matched };
      }
    }
  }
  if (!best) return null;
  return { category: best.category, confidenceScore: best.confidence, matchedTerms: best.matched };
}
