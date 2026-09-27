import type {
  BibleProvider,
  BibleVerse,
  BibleChapter,
  BibleSearchResult,
  BibleTranslation,
  BibleBook,
} from "../bibleProvider";

/**
 * TEST-ONLY mock. Never imported by application code (app/, src/lib outside
 * tests) — only by files under /tests. Returns clearly-labeled fake data so
 * it can never be mistaken for real Scripture if it somehow leaked into a
 * response (Phase 16 §1: "Do not present mock Scripture as production
 * Scripture").
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
      return {
        reference,
        bookName: "[TEST FIXTURE BOOK]",
        chapter: 1,
        verse: 1,
        text: "[TEST FIXTURE TEXT — not real Scripture, for automated tests only]",
        translationId,
      };
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
        translationId,
      };
    }
    return null;
  }

  async search(query: string, translationId: string): Promise<BibleSearchResult[]> {
    if (query.toLowerCase().includes("test-match")) {
      return [
        {
          reference: "MOCKBOOK.1.1",
          bookName: "[TEST FIXTURE BOOK]",
          chapter: 1,
          verse: 1,
          snippet: "[TEST FIXTURE SNIPPET]",
          translationId,
        },
      ];
    }
    return [];
  }
}
