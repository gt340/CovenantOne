"use client";

import { useState, useEffect, useRef } from "react";

type Citation = { rawText: string; verified: boolean };
type Msg = { role: "USER" | "ASSISTANT"; content: string; citations?: Citation[]; safetyNote?: string | null };
type Status = { bibleProvider: string; aiProvider: string };
type Plan = { id: string; studyType: string; title: string; status: string; steps: { title: string; completedAt: string | null }[] };
type MemoryItem = { id: string; category: string; key: string; value: unknown };

const STUDY_TYPES = ["MARRIAGE", "WISDOM", "PROVERBS", "FAITH", "LEADERSHIP", "BUSINESS_ETHICS", "FAMILY", "CHARACTER", "FORGIVENESS", "DISCIPLINE", "STEWARDSHIP"];

export default function AIPastorPage() {
  const [tab, setTab] = useState<"chat" | "studies" | "memory">("chat");
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
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

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
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
      setMessages((m) => [...m, { role: "ASSISTANT", content: data.response, citations: data.citations, safetyNote: data.safetyNote }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "ASSISTANT", content: err instanceof Error ? err.message : "Something went wrong." }]);
    } finally {
      setSending(false);
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

  const notConfigured = status && status.aiProvider === "NOT_CONFIGURED";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col min-h-screen">
      <h1 className="text-2xl font-semibold mb-1">AI Pastor</h1>
      <p className="text-xs text-gray-500 mb-4">
        I&apos;m an AI system — not a human pastor, minister, therapist, lawyer, or doctor. I can help you explore Scripture, but I can&apos;t replace those people. Scripture appears as cited text; everything else is my own explanation.
      </p>

      {notConfigured && (
        <div className="border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2 mb-4">
          AI PROVIDER: NOT_CONFIGURED — the AI Pastor can&apos;t respond yet. An administrator needs to add credentials.
        </div>
      )}
      {status && status.bibleProvider === "NOT_CONFIGURED" && !notConfigured && (
        <div className="border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2 mb-4">
          BIBLE PROVIDER: NOT_CONFIGURED — responses won&apos;t include retrieved Scripture until it&apos;s set up.
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b">
        {(["chat", "studies", "memory"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`text-sm px-3 py-2 border-b-2 -mb-px capitalize ${tab === t ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-gray-500"}`}>
            {t === "studies" ? "Bible studies" : t === "memory" ? "What I remember" : "Chat"}
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
                  <div className="text-xs mt-1 space-x-2">
                    {m.citations.map((c, j) => (
                      <span key={j} className={c.verified ? "text-green-600" : "text-amber-600"}>
                        {c.rawText} {c.verified ? "✓ verified" : "⚠ could not be verified"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="flex gap-2 sticky bottom-0 bg-white py-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask the AI Pastor..." className="flex-1 border rounded-md px-3 py-2 text-sm" />
            <button onClick={send} disabled={sending || !!notConfigured} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
              {sending ? "..." : "Send"}
            </button>
          </div>
        </>
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
          {plans.map((p) => (
            <div key={p.id} className="border rounded-md p-3">
              <div className="text-sm font-medium">{p.title}</div>
              <div className="text-xs text-gray-400 mb-2">{p.status}</div>
              {p.steps.map((s, i) => (
                <label key={i} className="flex items-center gap-2 text-sm py-0.5">
                  <input type="checkbox" checked={!!s.completedAt} onChange={(e) => toggleStep(p.id, i, e.target.checked)} />
                  <span className={s.completedAt ? "line-through text-gray-400" : ""}>{s.title}</span>
                </label>
              ))}
            </div>
          ))}
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
