// INTEGRATION TEST — talks to the REAL providers. Each provider skips itself
// (loudly, never a silent pass) when its credentials are absent.
// Run: BIBLE_API_KEY=... BIBLE_TEST_TRANSLATION_ID=... OPENAI_API_KEY=... GEMINI_API_KEY=... npx tsx tests/ai-pastor/integration.test.ts
import assert from "node:assert/strict";
import { getBibleProvider } from "../../src/lib/bibleProvider";
import { extractCitations, validateCitations } from "../../src/lib/aiPastor/citationValidation";
import { OpenAIProvider, OpenAIImageProvider } from "../../src/lib/ai/openai";
import { GeminiProvider, GeminiImageProvider, GeminiVideoProvider } from "../../src/lib/ai/gemini";

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

  if (!process.env.OPENAI_API_KEY) {
    console.log("  SKIPPED  OpenAI text: OPENAI_API_KEY not set");
  } else if (!process.env.OPENAI_MODEL) {
    console.log("  SKIPPED  OpenAI text: OPENAI_MODEL not set");
  } else {
    const p = new OpenAIProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL);
    const health = await p.healthCheck();
    assert.equal(health.state, "READY", `OpenAI health check failed: ${health.detail}`);
    console.log("  ok  OpenAI text provider connects");
    const r = await p.generateText({ system: "Reply with exactly: OK", messages: [{ role: "user", content: "ping" }], maxTokens: 5 });
    assert.ok(r.text.length > 0);
    console.log("  ok  OpenAI text generation returns a response");
  }

  if (process.env.OPENAI_API_KEY && process.env.OPENAI_IMAGE_MODEL) {
    const p = new OpenAIImageProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_IMAGE_MODEL);
    const img = await p.generateImage({ prompt: "A simple abstract sunrise, no people, no text." });
    assert.ok(img.data.length > 0);
    console.log(`  ok  OpenAI image generation returns bytes (${img.mimeType})`);
  } else {
    console.log("  SKIPPED  OpenAI image: OPENAI_IMAGE_MODEL not set");
  }

  if (!process.env.GEMINI_API_KEY) {
    console.log("  SKIPPED  Gemini text: GEMINI_API_KEY not set");
  } else if (!process.env.GEMINI_MODEL) {
    console.log("  SKIPPED  Gemini text: GEMINI_MODEL not set");
  } else {
    const p = new GeminiProvider(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL);
    const health = await p.healthCheck();
    assert.equal(health.state, "READY", `Gemini health check failed: ${health.detail}`);
    console.log("  ok  Gemini text provider connects");
    const r = await p.generateText({ system: "Reply with exactly: OK", messages: [{ role: "user", content: "ping" }], maxTokens: 5 });
    assert.ok(r.text.length > 0);
    console.log("  ok  Gemini text generation returns a response");
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_IMAGE_MODEL) {
    const p = new GeminiImageProvider(process.env.GEMINI_API_KEY, process.env.GEMINI_IMAGE_MODEL);
    const img = await p.generateImage({ prompt: "A simple abstract sunrise, no people, no text." });
    assert.ok(img.data.length > 0);
    console.log(`  ok  Gemini image generation returns bytes (${img.mimeType})`);
  } else {
    console.log("  SKIPPED  Gemini image: GEMINI_IMAGE_MODEL not set");
  }

  // Video is intentionally NOT exercised end-to-end here — a real run costs
  // real money/time and this suite is meant to be safe to run casually.
  // UNVERIFIED against the live API until someone runs this deliberately.
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_VIDEO_MODEL && process.env.RUN_VIDEO_INTEGRATION_TEST === "true") {
    const p = new GeminiVideoProvider(process.env.GEMINI_API_KEY, process.env.GEMINI_VIDEO_MODEL);
    const start = await p.startVideo({ prompt: "A short, calm shot of sunrise over hills. No people, no text." });
    assert.ok(start.operationRef.length > 0);
    console.log("  ok  Gemini video generation starts and returns an operation reference (not polled to completion in this run)");
  } else {
    console.log("  SKIPPED  Gemini video: set GEMINI_VIDEO_MODEL and RUN_VIDEO_INTEGRATION_TEST=true to exercise this (costs real money/time)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
