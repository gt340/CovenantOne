// Scripture retrieval strategy (Phase 17 debug). This is the fix for the
// reported bug: natural-language topical questions were being sent to
// API.Bible's keyword search VERBATIM ("What does the Bible say about
// trusting God during difficult times?"), which matches no verse text and
// returns zero results. Explicit references ("Romans 8:28") were also never
// detected in the user's own question — only validated after the model
// generated its answer.
//
// API.Bible remains the sole Scripture source throughout. This module only
// decides WHAT to ask it and in what order; it never invents verse content.

import { extractCitations } from "./citationValidation";
import { TOPIC_SEARCH_TERMS, type PastoralTopic } from "./classification";

// Strips question phrasing and generic stopwords so a natural-language
// question becomes a real keyword query instead of a sentence. Deliberately
// NOT an AI call (deterministic, auditable, zero extra latency/cost) — the
// Commander's instruction permits an AI-assisted version later if this
// proves insufficient, but this is the minimal fix for the reported bug.
const STOPWORDS = new Set([
  "a","about","an","and","are","as","at","be","by","can","could","did","do","does","during","for","from",
  "give","gives","has","have","how","i","in","is","it","its","me","my","of","on","please",
  "say","says","show","shows","teach","teaches","tell","tells","that","the","this","to",
  "verse","verses","what","when","where","which","who","why","will","with","would","you","your",
  "bible","scripture","scriptures",
]);

export function buildKeywordQuery(question: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  return words.join(" ").trim();
}

/** Bare "Book Chapter" references (e.g. "Psalm 23") — no verse number, so not covered by extractCitations. */
export function extractBareChapterReference(question: string, bookIdMap: Record<string, string>): { bookId: string; bookName: string; chapter: number } | null {
  // Same book-matching shape as citationValidation's REFERENCE_PATTERN (single
  // word + optional leading 1-3 digit prefix for "1 Corinthians" etc.) minus
  // the colon/verse part — deliberately NOT a 2-word group: that over-consumes
  // ("Explain Psalm 23" would greedily match "Explain Psalm" as the book name
  // and then fail to find "Psalm 23" on its own).
  const pattern = /\b((?:[1-3]\s?)?[A-Za-z]+)\s(\d{1,3})\b(?!\s*:)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(question)) !== null) {
    const key = match[1].toLowerCase().replace(/\s+/g, "");
    const bookId = bookIdMap[key];
    if (bookId) return { bookId, bookName: match[1], chapter: Number(match[2]) };
  }
  return null;
}

/**
 * Builds the ordered list of retrieval attempts for a question. Each stage
 * only runs if the previous one yielded nothing — this is the "two-stage
 * (or more) approach" the debug task asked for, made explicit and testable
 * rather than buried in one search() call.
 */
export type RetrievalPlan =
  | { kind: "explicit_verses"; passageIds: string[] }
  | { kind: "explicit_chapter"; bookId: string; chapter: number }
  | { kind: "keyword_search"; query: string }
  | { kind: "topic_search"; query: string };

export function buildRetrievalPlan(question: string, topic: PastoralTopic, bookIdMap: Record<string, string>): RetrievalPlan[] {
  const plan: RetrievalPlan[] = [];

  const explicitVerses = extractCitations(question)
    .map((c) => c.passageId)
    .filter((id): id is string => id !== null);
  if (explicitVerses.length > 0) {
    plan.push({ kind: "explicit_verses", passageIds: [...new Set(explicitVerses)].slice(0, 3) });
  } else {
    const chapterRef = extractBareChapterReference(question, bookIdMap);
    if (chapterRef) plan.push({ kind: "explicit_chapter", bookId: chapterRef.bookId, chapter: chapterRef.chapter });
  }

  const keywordQuery = buildKeywordQuery(question);
  if (keywordQuery) plan.push({ kind: "keyword_search", query: keywordQuery });

  const topicTerms = TOPIC_SEARCH_TERMS[topic];
  if (topicTerms && topicTerms !== keywordQuery) plan.push({ kind: "topic_search", query: topicTerms });

  return plan;
}
