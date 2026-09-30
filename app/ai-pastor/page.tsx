"use client";

import { useState, useEffect, useRef } from "react";

type Citation = { rawText: string; verified: boolean; translationId?: string; copyright?: string };
type MediaDecision = { shouldGenerateImage: boolean; shouldGenerateVideo: boolean; offerImage: boolean; reason: string };
type Msg = { role: "USER" | "ASSISTANT"; content: string; citations?: Citation[]; safetyNote?: string | null; media?: MediaDecision | null; mediaResult?: { label: string; url: string | null; status: string }; providerUsed?: string | null };
type Status = { bibleProvider: string; aiTextProvider: string; imageProvider: string; videoProvider: string; mediaMode: string };
type Plan = { id: string; studyType: string; title: string; status: string; steps: { title: string; completedAt: string | null }[] };
type MemoryItem = { id: string; category: string; key: string; value: unknown };
type Conversation = { id: string; title: string | null; updatedAt: string };
type Verse = { reference: string; text: string; translationId: string; copyright?: string };
type SearchResult = { reference: string; snippet: string; translationId: string };

const STUDY_TYPES = ["MARRIAGE", "WISDOM", "PROVERBS", "FAITH", "LEADERSHIP", "BUSINESS_ETHICS", "FAMILY", "CHARACTER", "FORGIVENESS", "DISCIPLINE", "STEWARDSHIP"];

export default function AIPastorPage() {
  const [tab, setTab] = useState<"chat" | "scripture" | "studies" | "memory">("chat");
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showPrayerBox, setShowPrayerBox] = useState(false);
  const [prayerTopic, setPrayerTopic] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [scriptureQuery, setScriptureQuery] = useState("");
  const [scriptureResults, setScriptureResults] = useState<SearchResult[]>([]);
  const [scriptureError, setScriptureError] = useState<string | null>(null);
  const [verseRef, setVerseRef] = useState("");
  const [verse, setVerse] = useState<Verse | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ai-pastor/status", { credentials: "include" }).then(async (r) => r.ok && setStatus(await r.json()));
  }, []);

  useEffect(() => {
    if (tab === "studies") fetch("/api/ai-pastor/study-plans", { credentials: "include" }).then(async (r) => r.ok && setPlans((await r.json()).plans));
    if (tab === "memory") fetch("/api/ai-pastor/memory", { credentials: "include" }).then(async (r) => r.ok && setMemory((await r.json()).memory));
  }, [tab]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadHistory() {
    const res = await fetch("/api/ai-pastor/conversations", { credentials: "include" });
    if (res.ok) setConversations((await res.json()).conversations ?? []);
    setShowHistory((s) => !s);
  }

  async function openConversation(id: string) {
    const res = await fetch(`/api/ai-pastor/conversations/${id}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setMessages((data.messages ?? []).map((m: any) => ({ role: m.role, content: m.content, citations: m.scriptureRefs ?? undefined })));
      setConversationId(id);
    }
    setShowHistory(false);
  }

  function newConversation() {
    setConversationId(undefined);
    setMessages([]);
    setShowHistory(false);
  }

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    if (!overrideText) setInput("");
    setSending(true);
    setMessages((m) => [...m, { role: "USER", content: text }]);
    try {
      const res = await fetch("/api/ai-pastor/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setConversationId(data.conversationId);
      setMessages((m) => [...m, { role: "ASSISTANT", content: data.response, citations: data.citations, safetyNote: data.safetyNote, media: data.mediaDecision, providerUsed: data.providerUsed }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "ASSISTANT", content: err instanceof Error ? err.message : "Something went wrong." }]);
    } finally {
      setSending(false);
    }
  }

  function sendPrayerRequest() {
    const topic = prayerTopic.trim();
    if (!topic) return;
    setShowPrayerBox(false);
    setPrayerTopic("");
    send(`Please write a short prayer about: ${topic}`);
  }

  async function requestImage(index: number, subject: string) {
    setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, mediaResult: { label: "AI-generated illustration", url: null, status: "PROCESSING" } } : msg)));
    try {
      const res = await fetch("/api/ai-pastor/media", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "IMAGE", subject, conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not start image generation.");
      setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, mediaResult: { label: data.job.label, url: data.url ?? null, status: data.job.status } } : msg)));
    } catch (err) {
      setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, mediaResult: { label: err instanceof Error ? err.message : "Failed", url: null, status: "FAILED" } } : msg)));
    }
  }

  async function startStudy(studyType: string) {
    const res = await fetch("/api/ai-pastor/study-plans", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studyType }),
    });
    if (res.ok) {
      const list = await fetch("/api/ai-pastor/study-plans", { credentials: "include" });
      if (list.ok) setPlans((await list.json()).plans);
    }
  }

  async function toggleStep(planId: string, index: number, completed: boolean) {
    await fetch(`/api/ai-pastor/study-plans/${planId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepIndex: index, completed }),
    });
    const list = await fetch("/api/ai-pastor/study-plans", { credentials: "include" });
    if (list.ok) setPlans((await list.json()).plans);
  }

  async function forget(id: string) {
    await fetch(`/api/ai-pastor/memory?id=${id}`, { method: "DELETE", credentials: "include" });
    setMemory((m) => m.filter((x) => x.id !== id));
  }

  // Progress is derived, not stored separately — NOT_STARTED/IN_PROGRESS/COMPLETED
  // from the same steps array the DB already holds (Phase 17 §15).
  function studyProgress(p: Plan) {
    const done = p.steps.filter((s) => s.completedAt).length;
    const pct = p.steps.length ? Math.round((done / p.steps.length) * 100) : 0;
    const state = done === 0 ? "NOT_STARTED" : done === p.steps.length ? "COMPLETED" : "IN_PROGRESS";
    return { pct, state };
  }

  async function runScriptureSearch() {
    setScriptureError(null);
    setScriptureResults([]);
    const q = scriptureQuery.trim();
    if (!q) return;
    const res = await fetch(`/api/ai-pastor/scripture/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setScriptureError(data?.status === "NOT_CONFIGURED" ? "BIBLE PROVIDER: NOT_CONFIGURED — Scripture search isn't available yet." : data?.error ?? "Search failed.");
      return;
    }
    setScriptureResults(data.results ?? []);
  }

  async function lookupVerse() {
    setScriptureError(null);
    setVerse(null);
    const ref = verseRef.trim();
    if (!ref) return;
    const res = await fetch(`/api/ai-pastor/scripture/verse?ref=${encodeURIComponent(ref)}`, { credentials: "include" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setScriptureError(
        data?.status === "NOT_CONFIGURED"
          ? "BIBLE PROVIDER: NOT_CONFIGURED — verse lookup isn't available yet."
          : res.status === 404
          ? "That reference wasn't found. Use a book code like PRO.3.5."
          : data?.error ?? "Lookup failed."
      );
      return;
    }
    setVerse(data.verse);
  }

  const notConfigured = status && status.aiTextProvider === "NOT_CONFIGURED";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col min-h-screen">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">AI Pastor</h1>
        {tab === "chat" && (
          <div className="flex gap-2 text-xs">
            <button onClick={loadHistory} className="text-gray-500 hover:underline">History</button>
            <button onClick={newConversation} className="text-blue-600 hover:underline">New</button>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        I&apos;m an AI system — not a human pastor, minister, therapist, lawyer, or doctor. I can help you explore Scripture, but I can&apos;t replace those people. Scripture appears as cited text; any image or video is an AI-generated illustration, not history.
      </p>

      {notConfigured && (
        <div className="border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2 mb-4">
          AI TEXT PROVIDER: NOT_CONFIGURED — the AI Pastor can&apos;t respond yet. An administrator needs to add credentials.
        </div>
      )}
      {status && status.bibleProvider === "NOT_CONFIGURED" && !notConfigured && (
        <div className="border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2 mb-4">
          BIBLE PROVIDER: NOT_CONFIGURED — responses won&apos;t include retrieved Scripture until it&apos;s set up.
        </div>
      )}

      {showHistory && (
        <div className="border rounded-md mb-4 max-h-48 overflow-y-auto">
          {conversations.length === 0 && <div className="text-xs text-gray-400 p-3">No past conversations yet.</div>}
          {conversations.map((c) => (
            <button key={c.id} onClick={() => openConversation(c.id)} className="block w-full text-left text-sm px-3 py-2 hover:bg-gray-50 border-b last:border-b-0">
              {c.title || "Untitled"} <span className="text-xs text-gray-400">· {new Date(c.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b overflow-x-auto">
        {(["chat", "scripture", "studies", "memory"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`text-sm px-3 py-2 border-b-2 -mb-px capitalize whitespace-nowrap ${tab === t ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-gray-500"}`}>
            {t === "studies" ? "Bible studies" : t === "memory" ? "What I remember" : t === "scripture" ? "Scripture" : "Chat"}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <>
          <div className="flex-1 space-y-3 mb-4">
            {messages.length === 0 && <div className="text-sm text-gray-400 text-center py-8">Ask about a verse, a topic, or something you&apos;re working through.</div>}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "USER" ? "text-right" : ""}>
                <div className="text-xs text-gray-400 mb-0.5">{m.role === "USER" ? "You" : "AI PASTOR"}</div>
                <div className={`inline-block max-w-full text-left text-sm rounded-md px-3 py-2 whitespace-pre-wrap ${m.role === "USER" ? "bg-blue-50" : "border"}`}>{m.content}</div>
                {m.safetyNote && <div className="text-xs mt-1 border border-red-200 bg-red-50 text-red-700 rounded-md px-3 py-2">{m.safetyNote}</div>}
                {m.citations && m.citations.length > 0 && (
                  <div className="text-xs mt-1 space-y-0.5">
                    {m.citations.map((c, j) => (
                      <div key={j} className={c.verified ? "text-green-600" : "text-amber-600"}>
                        {c.rawText} {c.verified ? "✓ verified" : "⚠ could not be verified"}
                        {c.translationId && <span className="text-gray-400"> · {c.translationId}</span>}
                        {c.copyright && <span className="text-gray-400"> · {c.copyright}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {m.role === "ASSISTANT" && m.media?.offerImage && !m.mediaResult && (
                  <button onClick={() => requestImage(i, m.content.slice(0, 300))} className="text-xs mt-1 px-2 py-1 border rounded-full text-gray-500 hover:bg-gray-50">
                    + Generate an illustration for this
                  </button>
                )}
                {m.mediaResult && (
                  <div className="text-xs mt-1 border rounded-md p-2 inline-block">
                    <div className="text-gray-400">{m.mediaResult.label}</div>
                    {m.mediaResult.status === "PROCESSING" && <div className="text-gray-400">Generating...</div>}
                    {m.mediaResult.status === "FAILED" && <div className="text-red-600">{m.mediaResult.label}</div>}
                    {m.mediaResult.url && <img src={m.mediaResult.url} alt="AI-generated illustration" className="mt-1 max-w-xs rounded" />}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {showPrayerBox && (
            <div className="flex gap-2 mb-2">
              <input
                value={prayerTopic}
                onChange={(e) => setPrayerTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendPrayerRequest()}
                placeholder="What would you like prayer for?"
                className="flex-1 border rounded-md px-3 py-2 text-sm"
              />
              <button onClick={sendPrayerRequest} className="px-3 py-2 text-sm rounded-md border">Send</button>
            </div>
          )}
          <div className="flex gap-2 sticky bottom-0 bg-white py-2">
            <button onClick={() => setShowPrayerBox((s) => !s)} disabled={!!notConfigured} title="Request a prayer" className="px-3 py-2 text-sm rounded-md border disabled:opacity-40">
              🙏
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask the AI Pastor..." className="flex-1 border rounded-md px-3 py-2 text-sm" />
            <button onClick={() => send()} disabled={sending || !!notConfigured} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
              {sending ? "..." : "Send"}
            </button>
          </div>
        </>
      )}

      {tab === "scripture" && (
        <div className="space-y-6">
          {scriptureError && <div className="text-amber-700 bg-amber-50 border border-amber-300 rounded-md px-3 py-2 text-sm">{scriptureError}</div>}

          <div>
            <div className="text-xs text-gray-500 mb-1">Look up a verse (e.g. PRO.3.5)</div>
            <div className="flex gap-2">
              <input value={verseRef} onChange={(e) => setVerseRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookupVerse()} placeholder="PRO.3.5" className="flex-1 border rounded-md px-3 py-2 text-sm" />
              <button onClick={lookupVerse} className="px-4 py-2 text-sm rounded-md border">Look up</button>
            </div>
            {verse && (
              <div className="border rounded-md p-3 mt-2 text-sm">
                <div className="font-medium">{verse.reference}</div>
                <div className="mt-1">{verse.text}</div>
                <div className="text-xs text-gray-400 mt-2">
                  Translation: {verse.translationId}
                  {verse.copyright && <> · {verse.copyright}</>}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">Search by topic or keyword</div>
            <div className="flex gap-2">
              <input value={scriptureQuery} onChange={(e) => setScriptureQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runScriptureSearch()} placeholder="forgiveness, wisdom, marriage..." className="flex-1 border rounded-md px-3 py-2 text-sm" />
              <button onClick={runScriptureSearch} className="px-4 py-2 text-sm rounded-md border">Search</button>
            </div>
            <div className="space-y-2 mt-2">
              {scriptureResults.map((r, i) => (
                <div key={i} className="border rounded-md p-3 text-sm">
                  <div className="font-medium">{r.reference}</div>
                  <div className="mt-1 text-gray-700">{r.snippet}</div>
                  <div className="text-xs text-gray-400 mt-1">Translation: {r.translationId}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "studies" && (
        <div className="space-y-4">
          <div>
            <div className="text-xs text-gray-500 mb-1">Start a study</div>
            <div className="flex flex-wrap gap-2">
              {STUDY_TYPES.map((s) => (
                <button key={s} onClick={() => startStudy(s)} className="text-xs px-2.5 py-1 border rounded-full hover:bg-gray-50">
                  {s.replace(/_/g, " ").toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          {plans.length === 0 && <div className="text-sm text-gray-400">No studies yet.</div>}
          {plans.map((p) => {
            const progress = studyProgress(p);
            return (
              <div key={p.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-gray-400">{progress.state.replace(/_/g, " ")} · {progress.pct}%</div>
                </div>
                <div className="text-xs text-gray-400 mb-2">{p.status}</div>
                {p.steps.map((s, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm py-0.5">
                    <input type="checkbox" checked={!!s.completedAt} onChange={(e) => toggleStep(p.id, i, e.target.checked)} />
                    <span className={s.completedAt ? "line-through text-gray-400" : ""}>{s.title}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {tab === "memory" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">The AI Pastor only remembers study preferences and progress — not the private things you share in conversation. You can remove anything here.</p>
          {memory.length === 0 && <div className="text-sm text-gray-400">Nothing remembered.</div>}
          {memory.map((m) => (
            <div key={m.id} className="border rounded-md px-3 py-2 flex items-center justify-between text-sm">
              <div>
                <span className="text-gray-400 text-xs">{m.category.replace(/_/g, " ")}</span>
                <div>{m.key}: {JSON.stringify(m.value)}</div>
              </div>
              <button onClick={() => forget(m.id)} className="text-xs text-red-600">Forget</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
