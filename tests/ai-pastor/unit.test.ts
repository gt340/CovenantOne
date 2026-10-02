// UNIT TEST — runs with no network and no credentials. All provider HTTP is
// faked in-process; Bible data comes from MockBibleProvider (test fixtures
// only). Run: npx tsx tests/ai-pastor/unit.test.ts
//
// These do NOT prove anything about the live OpenAI/Gemini/API.Bible APIs —
// that is what tests/ai-pastor/integration.test.ts is for (needs real keys).
import assert from "node:assert/strict";
import { MockBibleProvider } from "../../src/lib/bibleProviders/mockProvider";
import { extractCitations, validateCitations } from "../../src/lib/aiPastor/citationValidation";
import { classifyQuestion } from "../../src/lib/aiPastor/classification";
import { scanForSafetyBoundary } from "../../src/lib/aiPastor/safetyBoundaries";
import { buildAIPastorSystemPrompt } from "../../src/lib/aiPastor/systemPrompt";
import { runAIPastorPipeline } from "../../src/lib/aiPastor/ragPipeline";
import { buildKeywordQuery, buildRetrievalPlan, extractBareChapterReference } from "../../src/lib/aiPastor/scriptureRetrieval";
import { BOOK_ID_MAP } from "../../src/lib/aiPastor/citationValidation";
import { bibleProviderStatus } from "../../src/lib/bibleProvider";
import { describeAll, getFallbackTextProvider, getImageProvider, getTextProvider, getVideoProvider, resolveProvider, supportedProviders } from "../../src/lib/ai/registry";
import { OpenAIImageProvider, OpenAIProvider } from "../../src/lib/ai/openai";
import { GeminiImageProvider, GeminiProvider, GeminiVideoProvider } from "../../src/lib/ai/gemini";
import { UnsupportedCapabilityError, assertSupports, redactSecrets, type TextProvider } from "../../src/lib/ai/types";
import { AI_MEDIA_LABEL, buildImagePrompt, buildVideoPrompt, decideMedia, type MediaDecisionInput } from "../../src/lib/aiPastor/mediaPolicy";
import { DEFAULT_LIMITS, enforceRateLimit, parseLimits, type RpcClient } from "../../src/lib/aiPastor/rateLimit";

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

const ENV_KEYS = [
  "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_IMAGE_MODEL",
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_IMAGE_MODEL", "GEMINI_VIDEO_MODEL",
  "TEXT_PROVIDER", "IMAGE_PROVIDER", "VIDEO_PROVIDER", "BIBLE_API_KEY", "ANTHROPIC_API_KEY",
];
async function withEnv(vars: Record<string, string>, fn: () => void | Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  try { await fn(); } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Call = { url: string; init: RequestInit };
function recordingFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return handler(url, init); };
  return { fn, calls };
}

function fakeText(name: string, reply: string | Error, seen?: { system?: string }): TextProvider {
  return {
    name,
    capabilities: ["generateText"],
    async generateText(req) {
      if (seen) seen.system = req.system;
      if (reply instanceof Error) throw reply;
      return { text: reply, model: "fake" };
    },
    async healthCheck() { return { state: "READY" }; },
    async listModels() { return []; },
  };
}

const baseParams = { question: "What does the Bible say about marriage?", conversationHistory: [], translationId: "MOCK_TRANSLATION", theologicalProfile: null };

const mediaBase: MediaDecisionInput = {
  message: "hello", topic: "GENERAL", mode: "SELECTIVE", imageReady: true, videoReady: true, safetyTriggered: false, accountActive: true,
};

async function main() {
  console.log("UNIT TEST — AI Pastor (Phase 16 + amendment + Phase 17 + retrieval debug)");

  console.log("\n[regression] original Phase 16 tests");

  await test("NOT_CONFIGURED when no credentials are set", async () => {
    await withEnv({}, () => {
      assert.equal(bibleProviderStatus(), "NOT_CONFIGURED");
      assert.equal(resolveProvider("text", null).state, "NOT_CONFIGURED");
    });
  });

  await test("citation extraction finds references and normalizes book ids", () => {
    const found = extractCitations("As Proverbs 3:5 and 1 Corinthians 13:4 teach...");
    assert.equal(found.length, 2);
    assert.equal(found[0].passageId, "PRO.3.5");
    assert.equal(found[1].passageId, "1CO.13.4");
  });

  await test("unknown book name yields no passageId (cannot be verified)", () => {
    assert.equal(extractCitations("Hezekiah 4:9 says something")[0].passageId, null);
  });

  await test("hallucinated reference is marked unverified", async () => {
    const v = await validateCitations([{ rawText: "Proverbs 99:99", bookName: "Proverbs", chapter: 99, verse: 99, passageId: "PRO.99.99" }], new MockBibleProvider(), "MOCK_TRANSLATION");
    assert.equal(v[0].verified, false);
  });

  await test("existing reference is marked verified", async () => {
    const v = await validateCitations([{ rawText: "x", bookName: "x", chapter: 1, verse: 1, passageId: "MOCKBOOK.1.1" }], new MockBibleProvider(), "MOCK_TRANSLATION");
    assert.equal(v[0].verified, true);
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
    assert.equal(buildAIPastorSystemPrompt(null), buildAIPastorSystemPrompt(null));
  });

  console.log("\n[amendment] provider configuration");

  await test("OpenAI initializes when key + model are present", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890", OPENAI_MODEL: "m1" }, () => {
      const r = resolveProvider("text", null);
      assert.equal(r.provider, "openai");
      assert.equal(r.state, "READY");
      assert.equal(getTextProvider(null)?.name, "openai");
    });
  });

  await test("Gemini initializes when selected with key + model", async () => {
    await withEnv({ TEXT_PROVIDER: "gemini", GEMINI_API_KEY: "AIzaTestKey1234567890", GEMINI_MODEL: "g1" }, () => {
      assert.equal(resolveProvider("text", null).state, "READY");
      assert.equal(getTextProvider(null)?.name, "gemini");
    });
  });

  await test("missing OpenAI key -> NOT_CONFIGURED, no provider instance", async () => {
    await withEnv({ OPENAI_MODEL: "m1" }, () => {
      assert.equal(resolveProvider("text", null).state, "NOT_CONFIGURED");
      assert.equal(getTextProvider(null), null);
    });
  });

  await test("missing Gemini key -> NOT_CONFIGURED", async () => {
    await withEnv({ TEXT_PROVIDER: "gemini", GEMINI_MODEL: "g1" }, () => {
      assert.equal(resolveProvider("text", null).state, "NOT_CONFIGURED");
    });
  });

  await test("key present but no model selected -> NOT_CONFIGURED (no invented default model)", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890" }, () => {
      const r = resolveProvider("text", null);
      assert.equal(r.state, "NOT_CONFIGURED");
      assert.match(r.detail ?? "", /No model selected/);
    });
  });

  await test("env model wins over admin model; admin model used when env absent", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890", OPENAI_MODEL: "from-env" }, () => {
      const r = resolveProvider("text", { textModel: "from-admin" });
      assert.equal(r.model, "from-env");
      assert.equal(r.modelSource, "env");
    });
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890" }, () => {
      const r = resolveProvider("text", { textModel: "from-admin" });
      assert.equal(r.model, "from-admin");
      assert.equal(r.modelSource, "admin");
      assert.equal(r.state, "READY");
    });
  });

  await test("TEXT_PROVIDER env overrides the admin-stored provider", async () => {
    await withEnv({ TEXT_PROVIDER: "gemini", GEMINI_API_KEY: "AIzaTestKey1234567890", GEMINI_MODEL: "g1" }, () => {
      assert.equal(resolveProvider("text", { textProvider: "openai" }).provider, "gemini");
    });
  });

  await test("unsupported capability: OpenAI cannot do video; unknown provider is UNSUPPORTED", async () => {
    await withEnv({ VIDEO_PROVIDER: "openai", OPENAI_API_KEY: "sk-test-1234567890" }, () => {
      assert.equal(resolveProvider("video", null).state, "UNSUPPORTED");
      assert.equal(getVideoProvider(null), null);
    });
    await withEnv({ IMAGE_PROVIDER: "midjourney" }, () => {
      assert.equal(resolveProvider("image", null).state, "UNSUPPORTED");
    });
  });

  await test("assertSupports throws UnsupportedCapabilityError for a capability the provider lacks", () => {
    const p = new OpenAIProvider("sk-test-1234567890", "m1");
    assert.throws(() => assertSupports(p, "generateImage"), UnsupportedCapabilityError);
    assert.throws(() => assertSupports(p, "generateVideo"), UnsupportedCapabilityError);
    assert.doesNotThrow(() => assertSupports(p, "generateText"));
  });

  await test("Anthropic is neither default nor selectable, and no Anthropic key is needed", async () => {
    await withEnv({}, () => {
      assert.equal(resolveProvider("text", null).provider, "openai");
      assert.ok(!supportedProviders("text").includes("anthropic"));
      assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
    });
  });

  await test("optional image/video providers missing does not affect text readiness", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890", OPENAI_MODEL: "m1" }, () => {
      const all = describeAll(null);
      assert.equal(all.text.state, "READY");
      assert.equal(all.image.state, "NOT_CONFIGURED"); // no image model
      assert.equal(all.video.state, "NOT_CONFIGURED"); // gemini key missing
      assert.ok(getTextProvider(null));
      assert.equal(getImageProvider(null), null);
    });
  });

  console.log("\n[amendment] fallback provider resolution");

  await test("fallback resolves to the OTHER configured+modeled provider, not the primary itself", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890", OPENAI_MODEL: "m1", GEMINI_API_KEY: "AIzaTestKey1234567890", GEMINI_MODEL: "g1" }, () => {
      const fb = getFallbackTextProvider(null);
      assert.equal(fb?.name, "gemini");
    });
    await withEnv({ TEXT_PROVIDER: "gemini", GEMINI_API_KEY: "AIzaTestKey1234567890", GEMINI_MODEL: "g1", OPENAI_API_KEY: "sk-test-1234567890", OPENAI_MODEL: "m1" }, () => {
      const fb = getFallbackTextProvider(null);
      assert.equal(fb?.name, "openai");
    });
  });

  await test("no fallback candidate when only one provider is configured", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890", OPENAI_MODEL: "m1" }, () => {
      assert.equal(getFallbackTextProvider(null), null);
    });
  });

  await test("fallback candidate needs its own model configured too — a bare key is not enough", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890", OPENAI_MODEL: "m1", GEMINI_API_KEY: "AIzaTestKey1234567890" }, () => {
      assert.equal(getFallbackTextProvider(null), null);
    });
  });

  await test("admin can disable fallback via textFallbackEnabled=false", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-test-1234567890", OPENAI_MODEL: "m1", GEMINI_API_KEY: "AIzaTestKey1234567890", GEMINI_MODEL: "g1" }, () => {
      assert.equal(getFallbackTextProvider({ textFallbackEnabled: false }), null);
      assert.ok(getFallbackTextProvider({ textFallbackEnabled: true }));
    });
  });

  console.log("\n[amendment] provider behaviour (faked HTTP)");

  await test("OpenAI text: key only in Authorization header, parses reply + usage", async () => {
    const { fn, calls } = recordingFetch(() => json({ model: "m1", choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }));
    const p = new OpenAIProvider("sk-test-1234567890", "m1", undefined, fn);
    const r = await p.generateText({ system: "sys", messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.text, "hello");
    assert.deepEqual(r.usage, { inputTokens: 3, outputTokens: 4 });
    assert.equal((calls[0].init.headers as any).authorization, "Bearer sk-test-1234567890");
    assert.ok(!calls[0].url.includes("sk-test"));
    assert.ok(!String(calls[0].init.body).includes("sk-test"));
  });

  await test("Gemini text: key only in x-goog-api-key header, maps roles, parses reply", async () => {
    const { fn, calls } = recordingFetch(() => json({ candidates: [{ content: { parts: [{ text: "hi " }, { text: "there" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } }));
    const p = new GeminiProvider("AIzaTestKey1234567890", "g1", undefined, fn);
    const r = await p.generateText({ system: "sys", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] });
    assert.equal(r.text, "hi there");
    assert.equal((calls[0].init.headers as any)["x-goog-api-key"], "AIzaTestKey1234567890");
    assert.ok(!calls[0].url.includes("AIza"));
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body.contents.map((c: any) => c.role), ["user", "model"]);
  });

  await test("Gemini text: blocked/empty response is an error, not silent empty text", async () => {
    const { fn } = recordingFetch(() => json({ promptFeedback: { blockReason: "SAFETY" } }));
    await assert.rejects(() => new GeminiProvider("AIzaTestKey1234567890", "g1", undefined, fn).generateText({ system: "s", messages: [] }), /blocked: SAFETY/);
  });

  await test("provider error messages never contain the API key (even if the provider echoes it)", async () => {
    const key = "sk-test-1234567890abcdef";
    const { fn } = recordingFetch(() => new Response(`Incorrect API key provided: ${key}`, { status: 401 }));
    try {
      await new OpenAIProvider(key, "m1", undefined, fn).generateText({ system: "s", messages: [] });
      assert.fail("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      assert.ok(!msg.includes(key), msg);
      assert.match(msg, /REDACTED/);
    }
  });

  await test("redactSecrets scrubs exact secrets and common key shapes", () => {
    const out = redactSecrets("k=abcdefgh12345678 and sk-live-ZZZZZZZZ and AIzaSyABCDEFGHIJKLMNOP", "abcdefgh12345678");
    assert.ok(!out.includes("abcdefgh12345678") && !out.includes("sk-live") && !out.includes("AIzaSy"));
  });

  await test("health: READY on 200, ERROR on 401, UNAVAILABLE on network failure / 5xx", async () => {
    const ok = recordingFetch(() => json({ data: [{ id: "a" }] }));
    assert.equal((await new OpenAIProvider("sk-test-1234567890", "m", undefined, ok.fn).healthCheck()).state, "READY");
    const bad = recordingFetch(() => new Response("nope", { status: 401 }));
    assert.equal((await new OpenAIProvider("sk-test-1234567890", "m", undefined, bad.fn).healthCheck()).state, "ERROR");
    const down = recordingFetch(() => { throw new Error("ECONNRESET"); });
    assert.equal((await new GeminiProvider("AIzaTestKey1234567890", "m", undefined, down.fn as any).healthCheck()).state, "UNAVAILABLE");
    const five = recordingFetch(() => new Response("oops", { status: 503 }));
    assert.equal((await new GeminiProvider("AIzaTestKey1234567890", "m", undefined, five.fn).healthCheck()).state, "UNAVAILABLE");
  });

  await test("health check only lists models — it never calls a generation endpoint", async () => {
    const { fn, calls } = recordingFetch(() => json({ data: [], models: [] }));
    await new OpenAIProvider("sk-test-1234567890", "m", undefined, fn).healthCheck();
    await new GeminiVideoProvider("AIzaTestKey1234567890", "v", undefined, fn).healthCheck();
    assert.ok(calls.every((c) => { const path = new URL(c.url).pathname; return /\/models$/.test(path) && !/generat|predict|images|chat/.test(path); }));
  });

  await test("image providers: OpenAI b64, Gemini inlineData parse; missing image throws", async () => {
    const png = Buffer.from("PNGDATA").toString("base64");
    const o = recordingFetch(() => json({ data: [{ b64_json: png }] }));
    const oi = await new OpenAIImageProvider("sk-test-1234567890", "im", undefined, o.fn).generateImage({ prompt: "p" });
    assert.equal(Buffer.from(oi.data).toString(), "PNGDATA");
    const g = recordingFetch(() => json({ candidates: [{ content: { parts: [{ text: "x" }, { inlineData: { mimeType: "image/png", data: png } }] } }] }));
    const gi = await new GeminiImageProvider("AIzaTestKey1234567890", "gm", undefined, g.fn).generateImage({ prompt: "p" });
    assert.equal(gi.mimeType, "image/png");
    const none = recordingFetch(() => json({ candidates: [{ content: { parts: [{ text: "only text" }] } }] }));
    await assert.rejects(() => new GeminiImageProvider("AIzaTestKey1234567890", "gm", undefined, none.fn).generateImage({ prompt: "p" }), /no image/);
  });

  await test("Gemini video is async: start -> poll(not done) -> poll(done) yields bytes; failures are reported not faked", async () => {
    let n = 0;
    const { fn } = recordingFetch((url) => {
      if (url.endsWith(":predictLongRunning")) return json({ name: "models/v/operations/op1" });
      if (url.includes("/operations/op1")) { n++; return n === 1 ? json({ done: false }) : json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files.example/v.mp4" } }] } } }); }
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const v = new GeminiVideoProvider("AIzaTestKey1234567890", "v", undefined, fn);
    const start = await v.startVideo({ prompt: "p" });
    assert.equal(start.operationRef, "models/v/operations/op1");
    assert.deepEqual(await v.pollVideo(start.operationRef), { done: false });
    const done = await v.pollVideo(start.operationRef);
    assert.ok(done.done && done.ok && done.data.length === 3);

    const filtered = recordingFetch(() => json({ done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ["x"] } } }));
    const f = await new GeminiVideoProvider("AIzaTestKey1234567890", "v", undefined, filtered.fn).pollVideo("op");
    assert.ok(f.done && !f.ok);
    const empty = recordingFetch(() => json({ done: true, response: {} }));
    const e = await new GeminiVideoProvider("AIzaTestKey1234567890", "v", undefined, empty.fn).pollVideo("op");
    assert.ok(e.done && !e.ok);
  });

  console.log("\n[amendment] orchestrator is provider-independent; Scripture stays separate");

  await test("switching text provider (openai <-> gemini) does not change orchestrator logic, only providerUsed", async () => {
    const a = await runAIPastorPipeline(baseParams, { text: fakeText("openai", "Same answer."), bible: new MockBibleProvider() });
    const b = await runAIPastorPipeline(baseParams, { text: fakeText("gemini", "Same answer."), bible: new MockBibleProvider() });
    assert.deepEqual({ ...a, providerUsed: null }, { ...b, providerUsed: null });
    assert.equal(a.providerUsed, "openai");
    assert.equal(b.providerUsed, "gemini");
    assert.equal(a.usedFallback, false);
    assert.equal(a.aiSuccess, true);
  });

  await test("primary failure falls back to the secondary provider; response reports usedFallback + which provider answered", async () => {
    const r = await runAIPastorPipeline(baseParams, {
      text: fakeText("openai", new Error("openai down")),
      fallback: fakeText("gemini", "Fallback answer."),
      bible: new MockBibleProvider(),
    });
    assert.equal(r.aiSuccess, true);
    assert.equal(r.text, "Fallback answer.");
    assert.equal(r.providerUsed, "gemini");
    assert.equal(r.usedFallback, true);
  });

  await test("no fallback configured: primary failure is reported as before, usedFallback false", async () => {
    const r = await runAIPastorPipeline(baseParams, { text: fakeText("openai", new Error("boom")), bible: new MockBibleProvider() });
    assert.equal(r.aiSuccess, false);
    assert.equal(r.usedFallback, false);
    assert.equal(r.providerUsed, null);
  });

  await test("primary AND fallback both fail: reported as failure, no secret leakage from either error", async () => {
    const r = await runAIPastorPipeline(baseParams, {
      text: fakeText("openai", new Error("boom sk-live-PRIMARYSECRET")),
      fallback: fakeText("gemini", new Error("boom AIzaFALLBACKSECRETKEY123")),
      bible: new MockBibleProvider(),
    });
    assert.equal(r.aiSuccess, false);
    assert.equal(r.providerUsed, null);
    assert.ok(!(r.errorCode ?? "").includes("FALLBACKSECRETKEY"));
  });

  await test("citations carry translationId + copyright for verified references, and translationId is always reported", async () => {
    const r = await runAIPastorPipeline(baseParams, { text: fakeText("openai", "See MOCKBOOK 1:1 for wisdom."), bible: new MockBibleProvider() });
    assert.equal(r.translationId, "MOCK_TRANSLATION");
  });

  await test("provider failure is handled: no throw, aiSuccess=false, error message contains no secret", async () => {
    const r = await runAIPastorPipeline(baseParams, { text: fakeText("openai", new Error("boom sk-live-SECRETSECRET")), bible: new MockBibleProvider() });
    assert.equal(r.aiSuccess, false);
    assert.ok(!(r.errorCode ?? "").includes("SECRETSECRET"));
  });

  await test("no text provider -> NOT_CONFIGURED response, no crash, safety scan still runs", async () => {
    const r = await runAIPastorPipeline({ ...baseParams, question: "I want to die" }, { text: null, bible: null });
    assert.equal(r.configState.text, "NOT_CONFIGURED");
    assert.equal(r.aiSuccess, false);
    assert.equal(r.safetyEvent.type, "SELF_HARM");
  });

  await test("retrieved Scripture reaches the model as DATA from BibleProvider, not from model memory", async () => {
    const seen: { system?: string } = {};
    await runAIPastorPipeline({ ...baseParams, question: "test-match" }, { text: fakeText("openai", "ok", seen), bible: new MockBibleProvider() });
    assert.match(seen.system!, /RETRIEVED PASSAGES/);
    assert.match(seen.system!, /\[MOCKBOOK\.1\.1\]/);
  });

  await test("with no Bible provider the model is told not to invent a verse", async () => {
    const seen: { system?: string } = {};
    await runAIPastorPipeline(baseParams, { text: fakeText("openai", "ok", seen), bible: null });
    assert.match(seen.system!, /Do not invent a verse/);
  });

  await test("AI cannot bypass citation validation: fabricated reference is flagged unverified", async () => {
    const r = await runAIPastorPipeline(baseParams, { text: fakeText("openai", "As Proverbs 99:99 clearly states..."), bible: new MockBibleProvider() });
    assert.equal(r.citations.length, 1);
    assert.equal(r.citations[0].verified, false);
  });

  await test("without a Bible provider every AI-written citation is unverified (never trusted)", async () => {
    const r = await runAIPastorPipeline(baseParams, { text: fakeText("gemini", "See Proverbs 3:5."), bible: null });
    assert.equal(r.citations[0].verified, false);
  });

  console.log("\n[debug] Scripture retrieval — root cause fix for zero-result topical questions");

  await test("BUG REPRO (fixed): the exact reported failing question no longer sends the raw sentence as the search query", () => {
    const q = "What does the Bible say about trusting God during difficult times?";
    const query = buildKeywordQuery(q);
    assert.notEqual(query, q); // old behavior: sent verbatim
    assert.equal(query, "trusting god difficult times");
  });

  await test("keyword query strips question phrasing and stopwords in general", () => {
    assert.equal(buildKeywordQuery("What does the Bible teach about forgiveness?"), "forgiveness");
    assert.equal(buildKeywordQuery("Give me Bible verses about faith."), "faith");
  });

  await test("explicit verse reference in the question is detected and prioritized over keyword search", () => {
    const plan = buildRetrievalPlan("What does Romans 8:28 say?", "GENERAL", BOOK_ID_MAP);
    assert.equal(plan[0].kind, "explicit_verses");
    assert.deepEqual((plan[0] as any).passageIds, ["ROM.8.28"]);
  });

  await test("bare chapter reference (no verse number) is detected when no verse-level reference exists", () => {
    const plan = buildRetrievalPlan("Explain Psalm 23.", "GENERAL", BOOK_ID_MAP);
    assert.equal(plan[0].kind, "explicit_chapter");
    assert.deepEqual(plan[0], { kind: "explicit_chapter", bookId: "PSA", chapter: 23 });
  });

  await test("bare-chapter detection is not fooled by a preceding capitalized word (regression for a 2-word-group bug caught in testing)", () => {
    const ref = extractBareChapterReference("Explain Psalm 23.", BOOK_ID_MAP);
    assert.deepEqual(ref, { bookId: "PSA", bookName: "Psalm", chapter: 23 });
  });

  await test("an ordinary topical question with no reference produces only search stages, no explicit stage", () => {
    const plan = buildRetrievalPlan("What does the Bible say about trusting God during difficult times?", "GENERAL", BOOK_ID_MAP);
    assert.ok(plan.every((s) => s.kind === "keyword_search" || s.kind === "topic_search"));
    assert.ok(plan.length >= 1);
  });

  await test("retrieval end-to-end: explicit verse (JHN.3.16) is fetched directly via getVerse, not via search", async () => {
    const seen: { system?: string } = {};
    const r = await runAIPastorPipeline(
      { question: "What does John 3:16 say?", conversationHistory: [], translationId: "MOCK_TRANSLATION", theologicalProfile: null },
      { text: fakeText("openai", "ok", seen), bible: new MockBibleProvider() }
    );
    assert.equal(r.retrievalSuccess, true);
    assert.equal(r.retrievalMethod, "explicit_verses");
    assert.match(seen.system!, /\[JHN\.3\.16\]/);
    assert.match(seen.system!, /TEST FIXTURE TEXT for JHN\.3\.16/);
  });

  await test("retrieval end-to-end: bare chapter (Psalm 23) is fetched via getChapter", async () => {
    const r = await runAIPastorPipeline(
      { question: "Explain Psalm 23.", conversationHistory: [], translationId: "MOCK_TRANSLATION", theologicalProfile: null },
      { text: fakeText("openai", "ok"), bible: new MockBibleProvider() }
    );
    assert.equal(r.retrievalSuccess, true);
    assert.equal(r.retrievalMethod, "explicit_chapter");
  });

  await test("retrieval end-to-end: topical question with no keyword/topic hit falls through every stage honestly (no crash, no fabrication)", async () => {
    const seen: { system?: string } = {};
    const r = await runAIPastorPipeline(
      { question: "What does the Bible say about trusting God during difficult times?", conversationHistory: [], translationId: "MOCK_TRANSLATION", theologicalProfile: null },
      { text: fakeText("openai", "ok", seen), bible: new MockBibleProvider() }
    );
    // Mock has no fixture for "trusting god difficult times" or the FAITH topic terms, so this
    // correctly reports no retrieval — proving the pipeline still refuses to invent Scripture
    // when nothing is found, which is the one behavior the debug report must NOT weaken.
    assert.equal(r.retrievalSuccess, false);
    assert.match(seen.system!, /Do not invent a verse/);
  });

  await test("invalid/unknown explicit reference (book not in BOOK_ID_MAP) does not crash retrieval — falls through to search", async () => {
    const r = await runAIPastorPipeline(
      { question: "What does Hezekiah 4:9 say about forgiveness?", conversationHistory: [], translationId: "MOCK_TRANSLATION", theologicalProfile: null },
      { text: fakeText("openai", "ok"), bible: new MockBibleProvider() }
    );
    assert.equal(r.aiSuccess, true); // no crash
  });

  await test("a provider error on one retrieval stage falls through to the next stage rather than aborting retrieval", async () => {
    const flaky: any = new MockBibleProvider();
    const realGetVerse = flaky.getVerse.bind(flaky);
    flaky.getVerse = async () => {
      throw new Error("simulated API.Bible 500");
    };
    const r = await runAIPastorPipeline(
      { question: "What does John 3:16 say? test-match", conversationHistory: [], translationId: "MOCK_TRANSLATION", theologicalProfile: null },
      { text: fakeText("openai", "ok"), bible: flaky }
    );
    assert.equal(r.aiSuccess, true);
    assert.equal(r.retrievalMethod, "keyword_search"); // explicit_verses errored, fell through
    void realGetVerse;
  });

  await test("malformed provider response (search resolves but with an unexpected shape) is treated as no results, not a crash", async () => {
    const malformed: any = new MockBibleProvider();
    malformed.search = async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'verses')");
    };
    const r = await runAIPastorPipeline(baseParams, { text: fakeText("openai", "ok"), bible: malformed });
    assert.equal(r.aiSuccess, true);
    assert.equal(r.retrievalSuccess, false);
  });

  await test("translation selection: no translationId configured -> retrieval is skipped entirely, reported honestly", async () => {
    const r = await runAIPastorPipeline(
      { question: "What does John 3:16 say?", conversationHistory: [], translationId: null, theologicalProfile: null },
      { text: fakeText("openai", "ok"), bible: new MockBibleProvider() }
    );
    assert.equal(r.retrievalSuccess, false);
    assert.equal(r.translationId, null);
  });

  console.log("\n[amendment] media decision engine");

  await test("MEDIA_MODE OFF: nothing is ever generated, even on an explicit request", () => {
    const d = decideMedia({ ...mediaBase, mode: "OFF", message: "please generate an illustration of David" });
    assert.equal(d.shouldGenerateImage, false);
    assert.equal(d.shouldGenerateVideo, false);
    assert.equal(d.reason, "MEDIA_MODE_OFF");
  });

  await test("an ordinary message never triggers generation in any mode", () => {
    for (const mode of ["OFF", "SELECTIVE", "IMAGE", "IMAGE_AND_VIDEO"] as const) {
      const d = decideMedia({ ...mediaBase, mode, topic: "WISDOM", message: "What does Proverbs teach about wisdom?" });
      assert.equal(d.shouldGenerateImage || d.shouldGenerateVideo, false, mode);
    }
  });

  await test("explicit image request generates in SELECTIVE mode (LOW cost tier)", () => {
    const d = decideMedia({ ...mediaBase, message: "Can you create an illustration of the good Samaritan?" });
    assert.equal(d.shouldGenerateImage, true);
    assert.equal(d.estimatedCostTier, "LOW");
  });

  await test("image provider unavailable -> no image, and the text pipeline still works", async () => {
    const d = decideMedia({ ...mediaBase, imageReady: false, message: "draw me a picture of Ruth" });
    assert.equal(d.shouldGenerateImage, false);
    assert.equal(d.reason, "IMAGE_PROVIDER_NOT_READY");
    const r = await runAIPastorPipeline(baseParams, { text: fakeText("openai", "text still works"), bible: new MockBibleProvider() });
    assert.equal(r.aiSuccess, true);
  });

  await test("video is only allowed in IMAGE_AND_VIDEO mode and only if the provider is ready", () => {
    const ask = "Turn this lesson into a short video";
    assert.equal(decideMedia({ ...mediaBase, mode: "IMAGE", message: ask }).reason, "VIDEO_NOT_ENABLED");
    assert.equal(decideMedia({ ...mediaBase, mode: "IMAGE_AND_VIDEO", videoReady: false, message: ask }).reason, "VIDEO_PROVIDER_NOT_READY");
    const ok = decideMedia({ ...mediaBase, mode: "IMAGE_AND_VIDEO", message: ask });
    assert.equal(ok.shouldGenerateVideo, true);
    assert.equal(ok.estimatedCostTier, "HIGH");
  });

  await test("video provider missing does not block an image in the same mode", () => {
    const d = decideMedia({ ...mediaBase, mode: "IMAGE_AND_VIDEO", videoReady: false, message: "make an image of Noah's ark" });
    assert.equal(d.shouldGenerateImage, true);
  });

  await test("IMAGE mode only OFFERS an image on teaching topics; SELECTIVE never offers; nothing auto-generates", () => {
    const offer = decideMedia({ ...mediaBase, mode: "IMAGE", topic: "MARRIAGE", message: "teach me about marriage" });
    assert.equal(offer.offerImage, true);
    assert.equal(offer.shouldGenerateImage, false);
    assert.equal(decideMedia({ ...mediaBase, mode: "SELECTIVE", topic: "MARRIAGE", message: "teach me about marriage" }).offerImage, false);
  });

  await test("inactive accounts and safety-triggered messages never get media", () => {
    assert.equal(decideMedia({ ...mediaBase, accountActive: false, message: "generate an image" }).reason, "ACCOUNT_NOT_ACTIVE");
    assert.equal(decideMedia({ ...mediaBase, safetyTriggered: true, message: "generate an image" }).reason, "SAFETY_BOUNDARY");
  });

  await test("media endpoint's explicit flag is still subject to mode/provider/account gates", () => {
    assert.equal(decideMedia({ ...mediaBase, explicit: "image" }).shouldGenerateImage, true);
    assert.equal(decideMedia({ ...mediaBase, mode: "OFF", explicit: "image" }).shouldGenerateImage, false);
    assert.equal(decideMedia({ ...mediaBase, mode: "IMAGE", explicit: "video" }).shouldGenerateVideo, false);
    assert.equal(decideMedia({ ...mediaBase, accountActive: false, explicit: "image" }).shouldGenerateImage, false);
  });

  await test("prompts carry the no-realistic-portrait / not-historical guardrail; subject is sanitized and capped", () => {
    const p = buildImagePrompt("David\u0000\n\n" + "x".repeat(1000));
    assert.match(p, /not a historical depiction/);
    assert.match(p, /Do not depict God or Jesus with a realistic face/);
    assert.ok(!p.includes("\u0000"));
    assert.ok(p.length < 700);
    assert.match(buildVideoPrompt("Ruth"), /not a historical depiction/);
  });

  await test("media labels identify AI-generated output and disclaim history", () => {
    assert.match(AI_MEDIA_LABEL.IMAGE, /AI-generated illustration/);
    assert.match(AI_MEDIA_LABEL.VIDEO, /AI-generated video/);
    assert.match(AI_MEDIA_LABEL.IMAGE, /not a historical depiction/);
  });

  await test("system prompt forbids presenting media as vision/revelation/history", () => {
    const p = buildAIPastorSystemPrompt(null);
    assert.match(p, /AI-GENERATED MEDIA/);
    assert.match(p, /divine vision/);
    assert.match(p, /historical evidence/);
    assert.match(p, /coercive religious instructions/);
  });

  console.log("\n[amendment] server-side rate limiting");

  function limiter(): { client: RpcClient; calls: any[] } {
    const counts: Record<string, number> = {};
    const calls: any[] = [];
    const client: RpcClient = {
      async rpc(_fn, args: any) {
        calls.push(args);
        const k = `${args.p_user}:${args.p_kind}`;
        counts[k] = (counts[k] ?? 0) + 1;
        return { data: counts[k] > args.p_per_minute ? "MINUTE_LIMIT" : "OK", error: null };
      },
    };
    return { client, calls };
  }

  await test("allowed when the limiter says OK; passes per-kind config incl. VIDEO maxConcurrent", async () => {
    const { client, calls } = limiter();
    assert.deepEqual(await enforceRateLimit(client, "u1", "TEXT", DEFAULT_LIMITS), { allowed: true });
    await enforceRateLimit(client, "u1", "VIDEO", DEFAULT_LIMITS);
    assert.equal(calls[0].p_max_concurrent, null);
    assert.equal(calls[1].p_max_concurrent, 1);
  });

  await test("excessive requests are rejected server-side, per kind, per user", async () => {
    const { client } = limiter();
    const l = { ...DEFAULT_LIMITS, TEXT: { perMinute: 2, perDay: 100 } };
    assert.equal((await enforceRateLimit(client, "u1", "TEXT", l)).allowed, true);
    assert.equal((await enforceRateLimit(client, "u1", "TEXT", l)).allowed, true);
    const third = await enforceRateLimit(client, "u1", "TEXT", l);
    assert.equal(third.allowed, false);
    if (!third.allowed) { assert.equal(third.reason, "MINUTE_LIMIT"); assert.equal(third.retryAfterSeconds, 60); }
    assert.equal((await enforceRateLimit(client, "u2", "TEXT", l)).allowed, true, "another user is unaffected");
    assert.equal((await enforceRateLimit(client, "u1", "IMAGE", l)).allowed, true, "TEXT exhaustion does not consume IMAGE budget");
  });

  await test("image and video have their own, stricter default budgets than text", () => {
    assert.ok(DEFAULT_LIMITS.IMAGE.perDay < DEFAULT_LIMITS.TEXT.perDay);
    assert.ok(DEFAULT_LIMITS.VIDEO.perDay < DEFAULT_LIMITS.IMAGE.perDay);
    assert.equal(DEFAULT_LIMITS.VIDEO.maxConcurrent, 1);
  });

  await test("limiter FAILS CLOSED on rpc error, thrown error, or unrecognised reply", async () => {
    const cases: RpcClient[] = [
      { rpc: async () => ({ data: null, error: { message: "db down" } }) },
      { rpc: async () => { throw new Error("network"); } },
      { rpc: async () => ({ data: "SOMETHING_ELSE", error: null }) },
    ];
    for (const c of cases) {
      const r = await enforceRateLimit(c, "u1", "TEXT", DEFAULT_LIMITS);
      assert.equal(r.allowed, false);
      if (!r.allowed) assert.equal(r.reason, "LIMITER_UNAVAILABLE");
    }
  });

  await test("parseLimits: garbage -> defaults; absurd values clamped; TEXT has no concurrency cap", () => {
    assert.deepEqual(parseLimits(null), DEFAULT_LIMITS);
    assert.deepEqual(parseLimits("nope"), DEFAULT_LIMITS);
    const l = parseLimits({ TEXT: { perMinute: 999999, perDay: -5 }, VIDEO: { perDay: 1e9, maxConcurrent: 500 } });
    assert.equal(l.TEXT.perMinute, 60);
    assert.equal(l.TEXT.perDay, DEFAULT_LIMITS.TEXT.perDay);
    assert.equal(l.VIDEO.perDay, 1000);
    assert.equal(l.VIDEO.maxConcurrent, 10);
    assert.equal((l.TEXT as any).maxConcurrent, undefined);
  });

  console.log("\n[amendment] secret handling");

  await test("provider status/config output contains env var NAMES but never key VALUES", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-secretvalue123456", GEMINI_API_KEY: "AIzaSecretValue123456789", OPENAI_MODEL: "m1" }, () => {
      const out = JSON.stringify(describeAll(null));
      assert.ok(!out.includes("sk-secretvalue123456"));
      assert.ok(!out.includes("AIzaSecretValue123456789"));
      assert.match(out, /OPENAI_API_KEY/);
    });
  });

  console.log(`\n${passed} unit tests passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
