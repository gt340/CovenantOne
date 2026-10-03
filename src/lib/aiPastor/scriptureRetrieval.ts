// Scripture retrieval strategy (Phase 17 debug + topic-retrieval hardening).
//
// First fix (debug pass): natural-language questions were sent to API.Bible
// VERBATIM as one search query, which almost never matches real verse text.
// Fixed by stripping question-phrasing/stopwords into one keyword query.
//
// Second fix (this pass): a single keyword query is still too narrow —
// API.Bible's search is lexical, so "trusting god difficult times" as one
// query misses verses that use different words for the same idea. This
// file now runs a BOUNDED set of queries (the keyword query plus a few
// curated concept phrases for the classified topic — see
// classification.ts's TOPIC_SEARCH_CONCEPTS, the existing taxonomy,
// extended rather than duplicated) and merges/deduplicates whatever
// API.Bible actually returns. It never generates an unbounded number of
// queries and never invents a verse to fill a gap.
//
// API.Bible remains the sole Scripture source throughout.

import { extractCitations } from "./citationValidation";
import { TOPIC_SEARCH_CONCEPTS, type PastoralTopic } from "./classification";

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

/** Hard ceiling on how many API.Bible queries one retrieval can issue — bounded by design, never "generate until something works." */
export const MAX_SEARCH_QUERIES = 6;

export type RetrievalPlan =
  | { kind: "explicit_verses"; passageIds: string[] }
  | { kind: "explicit_chapter"; bookId: string; chapter: number }
  | { kind: "multi_query_search"; queries: string[] };

/**
 * Builds the retrieval plan for a question: explicit reference stages first
 * (most authoritative — the member named an exact passage), then, if none
 * matched, a single multi_query_search stage carrying every query worth
 * trying — the keyword-extracted query plus the matched topic's curated
 * concepts, deduplicated and capped at MAX_SEARCH_QUERIES.
 */
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

  const queries: string[] = [];
  const keywordQuery = buildKeywordQuery(question);
  if (keywordQuery) queries.push(keywordQuery);
  for (const concept of TOPIC_SEARCH_CONCEPTS[topic] ?? []) {
    if (queries.length >= MAX_SEARCH_QUERIES) break;
    if (!queries.includes(concept)) queries.push(concept);
  }
  if (queries.length > 0) plan.push({ kind: "multi_query_search", queries: queries.slice(0, MAX_SEARCH_QUERIES) });

  return plan;
}
