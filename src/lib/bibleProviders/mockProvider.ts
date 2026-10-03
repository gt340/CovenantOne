import type { BibleProvider, BibleVerse, BibleChapter, BibleSearchResult, BibleTranslation, BibleBook } from "../bibleProvider";

/**
 * TEST-ONLY mock. Never imported by application code (app/, src/lib outside
 * tests) — only by files under /tests. Returns clearly-labeled fake data so
 * it can never be mistaken for real Scripture if it somehow leaked into a
 * response (Phase 16 §1: "Do not present mock Scripture as production
 * Scripture").
 *
 * search() simulates API.Bible's lexical behavior deliberately: the raw
 * keyword query from a natural-language question ("trusting god difficult
 * times") returns NOTHING, same as the real API did in production — only
 * the curated concept queries ("faith", "trust in the lord", "fear not")
 * return results, with an intentional overlap between two of them so the
 * pipeline's deduplication is actually exercised, not just assumed.
 */
export class MockBibleProvider implements BibleProvider {
  readonly name = "MOCK_TEST_ONLY";

  async healthCheck() {
    return { ok: true, detail: "mock provider — test environment only" };
  }

  async getTranslations(): Promise<BibleTranslation[]> {
    return [{ id: "MOCK_TRANSLATION", name: "[TEST FIXTURE — NOT A REAL TRANSLATION]" }];
  }

  async getBooks(): Promise<BibleBook[]> {
    return [{ id: "MOCKBOOK", name: "[TEST FIXTURE BOOK]", testament: "OLD" }];
  }

  async getVerse(reference: string, translationId: string): Promise<BibleVerse | null> {
    if (reference === "MOCKBOOK.1.1") {
      return { reference, bookName: "[TEST FIXTURE BOOK]", chapter: 1, verse: 1, text: "[TEST FIXTURE TEXT — not real Scripture, for automated tests only]", translationId };
    }
    if (reference === "JHN.3.16") {
      return { reference, bookName: "[TEST FIXTURE BOOK]", chapter: 3, verse: 16, text: "[TEST FIXTURE TEXT for JHN.3.16 — not real Scripture, for automated tests only]", translationId };
    }
    return null; // simulates "reference does not exist" for citation-validation tests
  }

  async getPassage(reference: string, translationId: string): Promise<BibleVerse[] | null> {
    const v = await this.getVerse(reference, translationId);
    return v ? [v] : null;
  }

  async getChapter(bookId: string, chapter: number, translationId: string): Promise<BibleChapter | null> {
    if (bookId === "MOCKBOOK" && chapter === 1) {
      return {
        reference: "MOCKBOOK.1",
        bookName: "[TEST FIXTURE BOOK]",
        chapter: 1,
        verses: [(await this.getVerse("MOCKBOOK.1.1", translationId))!],
        content: "[TEST FIXTURE CHAPTER CONTENT]",
        translationId,
      };
    }
    if (bookId === "PSA" && chapter === 23) {
      return { reference: "PSA.23", bookName: "[TEST FIXTURE BOOK]", chapter: 23, verses: [], content: "[TEST FIXTURE CHAPTER CONTENT for PSA.23]", translationId };
    }
    return null;
  }

  async search(query: string, translationId: string): Promise<BibleSearchResult[]> {
    const q = query.toLowerCase().trim();
    const fixture = (reference: string, snippet: string): BibleSearchResult => ({
      reference, bookName: "[TEST FIXTURE BOOK]", chapter: 0, verse: 0, snippet: `[TEST FIXTURE] ${snippet}`, translationId,
    });

    if (q.includes("test") && q.includes("match")) return [fixture("MOCKBOOK.1.1", "legacy test-match fixture")];

    // FAITH topic concepts — FAITH.2 appears under two different queries on
    // purpose, to exercise cross-query deduplication.
    if (q === "faith") return [fixture("FAITH.1", "faith snippet 1"), fixture("FAITH.2", "faith snippet 2")];
    if (q === "trust in the lord") return [fixture("FAITH.2", "faith snippet 2 (duplicate)"), fixture("FAITH.3", "faith snippet 3")];
    if (q === "fear not") return [fixture("FAITH.4", "faith snippet 4")];

    // FORGIVENESS topic concepts
    if (q === "forgive" || q === "forgiveness") return [fixture("FORGIVE.1", "forgiveness snippet")];

    // Everything else — including the raw keyword-extracted query from a
    // natural-language question, and the unused "hope"/"reconcile" concepts
    // — returns nothing, same as real API.Bible's lexical search did for
    // the originally-reported failing question.
    return [];
  }
}
