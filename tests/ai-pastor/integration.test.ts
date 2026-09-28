// INTEGRATION TEST — talks to the REAL providers. Skips itself (exit 0, clearly
// labeled SKIPPED) when credentials are absent, so it can never silently
// "pass" without having tested anything.
// Run: BIBLE_API_KEY=... BIBLE_TEST_TRANSLATION_ID=... ANTHROPIC_API_KEY=... npx tsx tests/ai-pastor/integration.test.ts
import assert from "node:assert/strict";
import { getBibleProvider } from "../../src/lib/bibleProvider";
import { getAIProvider } from "../../src/lib/aiProvider";
import { extractCitations, validateCitations } from "../../src/lib/aiPastor/citationValidation";

async function main() {
  console.log("INTEGRATION TEST — AI Pastor (live providers)");

  const bible = getBibleProvider();
  if (!bible) {
    console.log("  SKIPPED  Bible provider: BIBLE_API_KEY not set");
  } else {
    const translationId = process.env.BIBLE_TEST_TRANSLATION_ID;
    const health = await bible.healthCheck();
    assert.equal(health.ok, true, `Bible health check failed: ${health.detail}`);
    console.log("  ok  Bible provider connects");

    const translations = await bible.getTranslations();
    assert.ok(translations.length > 0, "provider returned no translations");
    console.log(`  ok  translation catalog returned ${translations.length} entries`);

    if (!translationId) {
      console.log("  SKIPPED  verse/search/citation checks: set BIBLE_TEST_TRANSLATION_ID to a translation your key is licensed for");
    } else {
      const verse = await bible.getVerse("PRO.3.5", translationId);
      assert.ok(verse && verse.text.length > 0, "PRO.3.5 should exist");
      console.log("  ok  verse retrieval (PRO.3.5)");

      const missing = await bible.getVerse("PRO.99.99", translationId);
      assert.equal(missing, null, "PRO.99.99 must not exist");
      console.log("  ok  nonexistent reference returns null");

      const results = await bible.search("forgive", translationId, 5);
      assert.ok(results.length > 0, "search for 'forgive' should return results");
      console.log("  ok  scripture search");

      const validated = await validateCitations(extractCitations("See Proverbs 3:5 and Proverbs 99:99."), bible, translationId);
      assert.equal(validated[0].verified, true);
      assert.equal(validated[1].verified, false);
      console.log("  ok  citation validation catches the fabricated reference");
    }
  }

  const ai = getAIProvider();
  if (!ai) {
    console.log("  SKIPPED  AI provider: ANTHROPIC_API_KEY not set");
  } else {
    const health = await ai.healthCheck();
    assert.equal(health.ok, true, `AI health check failed: ${health.detail}`);
    console.log("  ok  AI provider connects");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
