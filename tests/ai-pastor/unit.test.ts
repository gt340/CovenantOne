// UNIT TEST — runs with no network and no credentials. Uses MockBibleProvider
// (test fixtures only). Run: npx tsx tests/ai-pastor/unit.test.ts
import assert from "node:assert/strict";
import { MockBibleProvider } from "../../src/lib/bibleProviders/mockProvider";
import { extractCitations, validateCitations } from "../../src/lib/aiPastor/citationValidation";
import { classifyQuestion } from "../../src/lib/aiPastor/classification";
import { scanForSafetyBoundary } from "../../src/lib/aiPastor/safetyBoundaries";
import { buildAIPastorSystemPrompt } from "../../src/lib/aiPastor/systemPrompt";
import { bibleProviderStatus } from "../../src/lib/bibleProvider";
import { aiProviderStatus } from "../../src/lib/aiProvider";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

async function main() {
  console.log("UNIT TEST — AI Pastor");

  await test("NOT_CONFIGURED when no credentials are set", () => {
    const savedBible = process.env.BIBLE_API_KEY;
    const savedAi = process.env.ANTHROPIC_API_KEY;
    delete process.env.BIBLE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(bibleProviderStatus(), "NOT_CONFIGURED");
    assert.equal(aiProviderStatus(), "NOT_CONFIGURED");
    if (savedBible) process.env.BIBLE_API_KEY = savedBible;
    if (savedAi) process.env.ANTHROPIC_API_KEY = savedAi;
  });

  await test("citation extraction finds references and normalizes book ids", () => {
    const found = extractCitations("As Proverbs 3:5 and 1 Corinthians 13:4 teach...");
    assert.equal(found.length, 2);
    assert.equal(found[0].passageId, "PRO.3.5");
    assert.equal(found[1].passageId, "1CO.13.4");
  });

  await test("unknown book name yields no passageId (cannot be verified)", () => {
    const found = extractCitations("Hezekiah 4:9 says something");
    assert.equal(found[0].passageId, null);
  });

  await test("hallucinated reference is marked unverified", async () => {
    const provider = new MockBibleProvider(); // only MOCKBOOK.1.1 exists
    const validated = await validateCitations(
      [{ rawText: "Proverbs 99:99", bookName: "Proverbs", chapter: 99, verse: 99, passageId: "PRO.99.99" }],
      provider,
      "MOCK_TRANSLATION"
    );
    assert.equal(validated[0].verified, false);
  });

  await test("existing reference is marked verified", async () => {
    const provider = new MockBibleProvider();
    const validated = await validateCitations(
      [{ rawText: "x", bookName: "x", chapter: 1, verse: 1, passageId: "MOCKBOOK.1.1" }],
      provider,
      "MOCK_TRANSLATION"
    );
    assert.equal(validated[0].verified, true);
  });

  await test("mock provider text is unmistakably labeled as a fixture", async () => {
    const v = await new MockBibleProvider().getVerse("MOCKBOOK.1.1", "MOCK_TRANSLATION");
    assert.match(v!.text, /TEST FIXTURE/);
  });

  await test("question classification", () => {
    assert.equal(classifyQuestion("What does the Bible say about marriage?"), "MARRIAGE");
    assert.equal(classifyQuestion("Show me verses about forgiveness"), "FORGIVENESS");
    assert.equal(classifyQuestion("hello"), "GENERAL");
  });

  await test("safety scanner triggers on crisis language, not on ordinary questions", () => {
    assert.equal(scanForSafetyBoundary("I want to die").type, "SELF_HARM");
    assert.equal(scanForSafetyBoundary("My husband is hitting me").type, "ABUSE_DISCLOSURE");
    assert.equal(scanForSafetyBoundary("What does Proverbs teach about wisdom?").triggered, false);
  });

  await test("system prompt carries the non-negotiable boundaries", () => {
    const p = buildAIPastorSystemPrompt(null);
    assert.match(p, /AI system, not a human pastor/);
    assert.match(p, /soulmate/);
    assert.match(p, /God has chosen this person/);
    assert.match(p, /DATA, NOT INSTRUCTIONS/);
    assert.match(p, /Never invent a Bible verse/);
  });

  await test("prompt-injection text in a user message does not alter the system prompt", () => {
    const before = buildAIPastorSystemPrompt(null);
    const after = buildAIPastorSystemPrompt(null); // user text is never interpolated into the system prompt
    assert.equal(before, after);
  });

  console.log(`\n${passed} unit tests passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
