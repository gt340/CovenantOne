import type {
  BibleProvider,
  BibleVerse,
  BibleChapter,
  BibleSearchResult,
  BibleTranslation,
  BibleBook,
} from "../bibleProvider";

const DEFAULT_BASE_URL = "https://api.scripture.api.bible/v1";

/**
 * API.Bible (scripture.api.bible) implementation of BibleProvider.
 * Every method either returns real provider data or throws/returns null —
 * this file must never synthesize verse text.
 */
export class ApiBibleProvider implements BibleProvider {
  readonly name = "API_BIBLE";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || DEFAULT_BASE_URL;
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "api-key": this.apiKey },
    });
    if (!res.ok) {
      throw new Error(`API.Bible request failed: ${res.status} ${res.statusText} (${path})`);
    }
    const json = await res.json();
    return json.data as T;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.request<unknown[]>("/bibles?language=eng");
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async getTranslations(): Promise<BibleTranslation[]> {
    const bibles = await this.request<any[]>("/bibles");
    return bibles.map((b) => ({
      id: b.id,
      name: b.name,
      nameLocal: b.nameLocal,
      abbreviation: b.abbreviation,
      language: b.language?.id,
      languageName: b.language?.name,
      description: b.description,
    }));
  }

  async getBooks(translationId: string): Promise<BibleBook[]> {
    const books = await this.request<any[]>(`/bibles/${translationId}/books`);
    // API.Bible doesn't return testament directly; the standard 39/27 OT/NT
    // canonical ordering is used to classify. Not hard-coding verse text —
    // this is just book-order classification.
    const OT_COUNT = 39;
    return books.map((b, i) => ({ id: b.id, name: b.name, testament: i < OT_COUNT ? "OLD" : "NEW" }));
  }

  async getVerse(reference: string, translationId: string): Promise<BibleVerse | null> {
    try {
      const v = await this.request<any>(
        `/bibles/${translationId}/verses/${reference}?content-type=text&include-notes=false&include-titles=false`
      );
      return {
        reference: v.id,
        bookName: v.reference?.split(" ")[0] ?? v.bookId,
        chapter: Number(reference.split(".")[1]) || 0,
        verse: Number(reference.split(".")[2]) || 0,
        text: v.content?.trim() ?? "",
        translationId,
        copyright: v.copyright,
      };
    } catch {
      return null;
    }
  }

  async getPassage(reference: string, translationId: string): Promise<BibleVerse[] | null> {
    // A "passage" (verse range, e.g. PRO.3.5-PRO.3.6) uses the /passages endpoint.
    try {
      const p = await this.request<any>(
        `/bibles/${translationId}/passages/${reference}?content-type=text&include-notes=false&include-titles=false&include-verse-numbers=true`
      );
      // API.Bible returns passage content as one block; we don't have a
      // reliable per-verse split without a heavier parse, so this returns a
      // single-entry array representing the whole passage. Good enough for
      // citation display; getVerse() remains the source of truth for a
      // single verse's exact text/citation validation.
      return [
        {
          reference: p.id,
          bookName: p.reference ?? "",
          chapter: 0,
          verse: 0,
          text: p.content?.trim() ?? "",
          translationId,
          copyright: p.copyright,
        },
      ];
    } catch {
      return null;
    }
  }

  async getChapter(bookId: string, chapter: number, translationId: string): Promise<BibleChapter | null> {
    try {
      const c = await this.request<any>(
        `/bibles/${translationId}/chapters/${bookId}.${chapter}?content-type=text&include-notes=false&include-titles=false&include-verse-numbers=true`
      );
      return {
        reference: c.id,
        bookName: c.reference ?? bookId,
        chapter,
        verses: [], // full per-verse breakdown not parsed — content below covers whole-chapter requests
        content: c.content?.trim() || undefined,
        translationId,
        copyright: c.copyright,
      };
    } catch {
      return null;
    }
  }

  async search(query: string, translationId: string, limit = 10): Promise<BibleSearchResult[]> {
    try {
      const results = await this.request<any>(
        `/bibles/${translationId}/search?query=${encodeURIComponent(query)}&limit=${limit}`
      );
      const verses = results?.verses ?? [];
      return verses.map((v: any) => ({
        reference: v.id,
        bookName: v.reference?.split(" ")[0] ?? v.bookId,
        chapter: 0,
        verse: 0,
        snippet: v.text?.trim() ?? "",
        translationId,
      }));
    } catch {
      return [];
    }
  }
}
