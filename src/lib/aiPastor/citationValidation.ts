import type { BibleProvider } from "../bibleProvider";

/**
 * Citation validation (Phase 16 §6). Every Bible reference the AI's
 * response text claims to cite gets checked against the real provider
 * before being shown as a verified citation — this is what stops a
 * hallucinated "Proverbs 15:1 says..." from being displayed as if real.
 */

// Matches common reference shapes the model is instructed to use, e.g.
// "Proverbs 3:5", "Prov 3:5-6", "1 Corinthians 13:4". This is intentionally
// permissive on input; getBookId() below normalizes to API.Bible's book IDs.
const REFERENCE_PATTERN = /\b((?:[1-3]\s?)?[A-Za-z]+)\s(\d+):(\d+)(?:-(\d+))?\b/g;

const BOOK_ID_MAP: Record<string, string> = {
  genesis: "GEN", exodus: "EXO", leviticus: "LEV", numbers: "NUM", deuteronomy: "DEU",
  joshua: "JOS", judges: "JDG", ruth: "RUT", "1samuel": "1SA", "2samuel": "2SA",
  "1kings": "1KI", "2kings": "2KI", "1chronicles": "1CH", "2chronicles": "2CH",
  ezra: "EZR", nehemiah: "NEH", esther: "EST", job: "JOB", psalms: "PSA", psalm: "PSA",
  proverbs: "PRO", ecclesiastes: "ECC", "songofsolomon": "SNG", isaiah: "ISA",
  jeremiah: "JER", lamentations: "LAM", ezekiel: "EZK", daniel: "DAN", hosea: "HOS",
  joel: "JOL", amos: "AMO", obadiah: "OBA", jonah: "JON", micah: "MIC", nahum: "NAM",
  habakkuk: "HAB", zephaniah: "ZEP", haggai: "HAG", zechariah: "ZEC", malachi: "MAL",
  matthew: "MAT", mark: "MRK", luke: "LUK", john: "JHN", acts: "ACT", romans: "ROM",
  "1corinthians": "1CO", "2corinthians": "2CO", galatians: "GAL", ephesians: "EPH",
  philippians: "PHP", colossians: "COL", "1thessalonians": "1TH", "2thessalonians": "2TH",
  "1timothy": "1TI", "2timothy": "2TI", titus: "TIT", philemon: "PHM", hebrews: "HEB",
  james: "JAS", "1peter": "1PE", "2peter": "2PE", "1john": "1JN", "2john": "2JN",
  "3john": "3JN", jude: "JUD", revelation: "REV",
};

function normalizeBookName(raw: string): string | null {
  const key = raw.toLowerCase().replace(/\s+/g, "");
  return BOOK_ID_MAP[key] ?? null;
}

export type ExtractedCitation = { rawText: string; bookName: string; chapter: number; verse: number; passageId: string | null };

export function extractCitations(responseText: string): ExtractedCitation[] {
  const found: ExtractedCitation[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(REFERENCE_PATTERN);
  while ((match = re.exec(responseText)) !== null) {
    const [rawText, bookRaw, chapterStr, verseStr] = match;
    const bookId = normalizeBookName(bookRaw);
    found.push({
      rawText,
      bookName: bookRaw,
      chapter: Number(chapterStr),
      verse: Number(verseStr),
      passageId: bookId ? `${bookId}.${chapterStr}.${verseStr}` : null,
    });
  }
  return found;
}

// translationId/copyright are display metadata ONLY (Phase 17 §24 — show
// translation and preserve required attribution) — never a second copy of
// the verse text; the text itself stays in the model's own prose response,
// which is what avoids persisting/duplicating licensed Bible content here.
export type ValidatedCitation = ExtractedCitation & { verified: boolean; translationId?: string; copyright?: string };

/**
 * Confirms each extracted citation actually exists via the Bible provider.
 * A citation that can't be normalized to a known book, or that the
 * provider returns null for, is marked verified: false — callers should
 * surface this to the member rather than silently trusting the AI's text.
 */
export async function validateCitations(
  citations: ExtractedCitation[],
  provider: BibleProvider,
  translationId: string
): Promise<ValidatedCitation[]> {
  const results: ValidatedCitation[] = [];
  for (const c of citations) {
    if (!c.passageId) {
      results.push({ ...c, verified: false });
      continue;
    }
    const verse = await provider.getVerse(c.passageId, translationId);
    results.push({ ...c, verified: verse !== null, translationId: verse ? translationId : undefined, copyright: verse?.copyright });
  }
  return results;
}
