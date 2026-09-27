// Bible provider abstraction (Phase 16 §3/§4). The AI Pastor's Bible source
// is this interface — never the AI model's own training data. Adding a new
// vendor later means writing one new implementation of this interface, not
// touching the AI Pastor pipeline.
//
// Nothing in this file, or any implementation of it, may return invented
// Scripture. If the underlying provider can't answer, throw or return null —
// never fabricate a verse.

export type BibleVerse = {
  reference: string; // e.g. "PRO.3.5" (provider-native passage id)
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
  translationId: string;
  copyright?: string;
};

export type BibleChapter = {
  reference: string;
  bookName: string;
  chapter: number;
  verses: BibleVerse[];
  translationId: string;
  copyright?: string;
};

export type BibleSearchResult = {
  reference: string;
  bookName: string;
  chapter: number;
  verse: number;
  snippet: string;
  translationId: string;
};

export type BibleTranslation = {
  id: string;
  name: string;
  nameLocal?: string;
  abbreviation?: string;
  language?: string;
  languageName?: string;
  description?: string;
};

export type BibleBook = {
  id: string;
  name: string;
  testament: "OLD" | "NEW";
};

export interface BibleProvider {
  readonly name: string;
  getVerse(reference: string, translationId: string): Promise<BibleVerse | null>;
  getChapter(bookId: string, chapter: number, translationId: string): Promise<BibleChapter | null>;
  search(query: string, translationId: string, limit?: number): Promise<BibleSearchResult[]>;
  getPassage(reference: string, translationId: string): Promise<BibleVerse[] | null>;
  getTranslations(): Promise<BibleTranslation[]>;
  getBooks(translationId: string): Promise<BibleBook[]>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

export type BibleProviderStatus = "NOT_CONFIGURED" | "CONFIGURED";

/** Whether a Bible provider has credentials at all. Does not confirm they're valid — see healthCheck(). */
export function bibleProviderStatus(): BibleProviderStatus {
  return process.env.BIBLE_API_KEY ? "CONFIGURED" : "NOT_CONFIGURED";
}

/**
 * Factory. Returns null when no provider is configured — callers must
 * handle this explicitly (NOT_CONFIGURED state) rather than assuming a
 * provider instance always exists.
 */
export function getBibleProvider(): BibleProvider | null {
  if (bibleProviderStatus() === "NOT_CONFIGURED") return null;
  // API.Bible is the only implementation today (Phase 16 §1 decision).
  // Swapping providers later means branching here on ai_pastor_settings.bibleProvider.
  const { ApiBibleProvider } = require("./bibleProviders/apiBible");
  return new ApiBibleProvider(process.env.BIBLE_API_KEY!, process.env.BIBLE_API_BASE_URL);
}
