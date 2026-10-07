// Document ingestion (Phase 18 §9/§10). Scope, stated plainly: this version
// accepts plain text/markdown an admin pastes or uploads as a .txt/.md file
// — there is no binary PDF/DOCX extraction here. That's a deliberate scope
// decision, not a silent gap (see the Commander report). Embedding/semantic
// indexing is likewise not implemented — chunks are stored with
// embeddingStatus NOT_REQUESTED and retrieved via Postgres full-text search
// (search_approved_knowledge in the Phase 18 migration), not vector search.
//
// Pipeline stages actually implemented here: VALIDATE -> CLEAN -> CHUNK.
// METADATA/LICENSE CHECK/APPROVAL live in the API layer (knowledge source
// fields + the approval-workflow routes). EXTRACT is a no-op for plain text
// (it already is text). INDEX/EMBED is the documented scope gap above.

export type ChunkValidationError = "TOO_SHORT" | "TOO_LONG" | "EMPTY";

const MIN_CHARS = 20;
const MAX_CHARS = 200_000; // ~40k words — generous ceiling against pasting something unreasonable
const MAX_CHUNK_SIZE = 800;
const MIN_CHUNK_SIZE = 30; // only a genuinely tiny trailing fragment gets merged — not an ordinary short paragraph

export function validateRawContent(text: string): ChunkValidationError | null {
  const trimmed = text.trim();
  if (!trimmed) return "EMPTY";
  if (trimmed.length < MIN_CHARS) return "TOO_SHORT";
  if (trimmed.length > MAX_CHARS) return "TOO_LONG";
  return null;
}

/** Normalizes whitespace without altering wording — CLEAN stage. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Deterministic paragraph-based chunking — CHUNK stage. Splits on blank
 * lines first (preserves natural document structure), then hard-splits any
 * paragraph longer than MAX_CHUNK_SIZE at a sentence or word boundary.
 * Never splits mid-word. A genuinely tiny TRAILING fragment is merged into
 * the previous chunk rather than left as a near-empty chunk on its own.
 */
export function chunkText(text: string): string[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= MAX_CHUNK_SIZE) {
      chunks.push(para);
      continue;
    }
    // Hard-split an overlong paragraph on sentence boundaries where possible.
    const sentences = para.match(/[^.!?]+[.!?]+(\s+|$)/g) ?? [para];
    let current = "";
    for (const sentence of sentences) {
      if ((current + sentence).length > MAX_CHUNK_SIZE && current) {
        chunks.push(current.trim());
        current = "";
      }
      if (sentence.length > MAX_CHUNK_SIZE) {
        // A single sentence longer than the limit — hard word-boundary split.
        const words = sentence.split(/\s+/);
        let piece = "";
        for (const w of words) {
          if ((piece + " " + w).trim().length > MAX_CHUNK_SIZE) {
            chunks.push(piece.trim());
            piece = w;
          } else {
            piece = (piece + " " + w).trim();
          }
        }
        if (piece) current = piece;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }

  // Merge a tiny TRAILING fragment into its predecessor (e.g. an orphaned
  // leftover sentence after the last real paragraph) rather than shipping
  // it as a near-empty, low-signal chunk on its own. Deliberately only the
  // last chunk — ordinary short paragraphs earlier in the document (a
  // heading, a one-line answer) are legitimate chunks on their own and must
  // not be silently absorbed into whatever came before them.
  if (chunks.length > 1 && chunks[chunks.length - 1].length < MIN_CHUNK_SIZE) {
    const last = chunks.pop()!;
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${last}`.trim();
  }
  return chunks;
}
