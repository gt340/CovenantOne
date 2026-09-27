// Pastoral safety boundaries (Phase 16 §11). Deliberately reuses the same
// "heuristic, not AI-judged" pattern as src/lib/contentSafetyHeuristic.ts —
// a fixed, auditable rule set that runs on the user's own message before
// the AI ever sees it, so it can't be argued around by clever phrasing of
// a reply. This never blocks the conversation; it adds a safety-resources
// note to the response and logs the event for SAFETY_MODERATOR review.

export type SafetyEventType =
  | "SELF_HARM"
  | "ABUSE_DISCLOSURE"
  | "MEDICAL_EMERGENCY"
  | "LEGAL_MATTER"
  | "FINANCIAL_DISTRESS"
  | "CRIMINAL_ACTIVITY"
  | "OTHER_CRISIS";

const SAFETY_PATTERNS: { type: SafetyEventType; patterns: RegExp[]; note: string }[] = [
  {
    type: "SELF_HARM",
    patterns: [/\bsuicide\b/i, /\bkill myself\b/i, /\bself[- ]harm\b/i, /\bwant to die\b/i, /\bending it all\b/i],
    note: "If you're in crisis or thinking about suicide, please reach out to a crisis line or emergency services in your area right now — this matters more than anything else in our conversation. I'm an AI and can't provide the help you need in that moment; a person can.",
  },
  {
    type: "ABUSE_DISCLOSURE",
    patterns: [/\babuse\b/i, /\bhitting me\b/i, /\bdomestic violence\b/i, /\bafraid of my (husband|wife|spouse|partner)\b/i],
    note: "What you're describing matters, and I want to be honest that I'm not equipped to keep you safe on my own. Please consider reaching out to a domestic violence hotline, a trusted pastor, or local authorities — a trained human can help in ways I can't.",
  },
  {
    type: "MEDICAL_EMERGENCY",
    patterns: [/\bchest pain\b/i, /\bcan'?t breathe\b/i, /\bmedical emergency\b/i, /\boverdose\b/i],
    note: "This sounds like it may be a medical emergency. Please contact emergency services or a doctor right away — I'm not able to help with that.",
  },
  {
    type: "LEGAL_MATTER",
    patterns: [/\bshould i sue\b/i, /\blawyer\b.{0,20}\bneed\b/i, /\blegal advice\b/i],
    note: "This sounds like it needs real legal advice, which I'm not qualified to give. Please consult a licensed attorney for anything with legal consequences.",
  },
  {
    type: "FINANCIAL_DISTRESS",
    patterns: [/\bbankrupt/i, /\bcan'?t pay (my )?(bills|rent|mortgage)\b/i, /\bdebt collector\b/i],
    note: "For decisions with real financial consequences, please also talk to a qualified financial professional — I can share biblical principles on stewardship, but I can't replace personalized financial advice.",
  },
  {
    type: "CRIMINAL_ACTIVITY",
    patterns: [/\breport(ed)? to (the )?police\b/i, /\bcommitted a crime\b/i, /\bcriminal charge\b/i],
    note: "For anything involving the law or criminal matters, please speak with a licensed attorney rather than relying on this conversation.",
  },
];

export type SafetyScanResult = {
  triggered: boolean;
  type: SafetyEventType | null;
  note: string | null;
};

export function scanForSafetyBoundary(text: string): SafetyScanResult {
  for (const rule of SAFETY_PATTERNS) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { triggered: true, type: rule.type, note: rule.note };
    }
  }
  return { triggered: false, type: null, note: null };
}
