"use client";

import { useCallback, useEffect, useState } from "react";

// Phase 18 Knowledge Center. Every control here calls a real admin API route;
// nothing is decorative. Access is gated by app/admin/layout.tsx (ADMIN+) and
// re-checked server-side on every route.

const STATUSES = ["DRAFT", "UNDER_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"];
const TYPES = ["BIBLE_API","BIBLE_DATASET","SERMON","TEACHING","ARTICLE","BOOK","COURSE","STUDY_GUIDE","COVENANTONE_DOCUMENT","FAQ","POLICY","OTHER_APPROVED_SOURCE"];
const LICENSES = ["LICENSE_VERIFIED","LICENSE_UNKNOWN","LICENSE_REQUIRES_REVIEW","RESTRICTED","PUBLIC_DOMAIN","OTHER_APPROVED_STATUS"];
const TRUST = ["OFFICIAL","VERIFIED","COMMUNITY","UNVERIFIED"];

type Source = Record<string, any>;
type Tab = "sources" | "create" | "retrieval" | "bible";

const box: React.CSSProperties = { border: "1px solid #d4d4d8", borderRadius: 8, padding: 12, marginBottom: 12, background: "#fff" };
const input: React.CSSProperties = { width: "100%", padding: 8, border: "1px solid #a1a1aa", borderRadius: 6, marginBottom: 8, boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid #3f3f46", background: "#18181b", color: "#fff", marginRight: 8, marginBottom: 8, cursor: "pointer" };
const btnAlt: React.CSSProperties = { ...btn, background: "#fff", color: "#18181b" };
const pill = (s: string): React.CSSProperties => ({
  display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 12, marginRight: 6,
  background: s === "APPROVED" ? "#dcfce7" : s === "REJECTED" || s === "RESTRICTED" ? "#fee2e2" : s === "ARCHIVED" ? "#e4e4e7" : "#fef9c3",
});

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export default function KnowledgeCenterPage() {
  const [tab, setTab] = useState<Tab>("sources");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const note = useCallback((ok: boolean, text: string) => setMsg({ ok, text }), []);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22 }}>Knowledge Center</h1>
      <p style={{ color: "#52525b", fontSize: 14 }}>
        Governs which non-Scripture material the AI Pastor may use. Only APPROVED sources with a resolved licence reach members. Scripture is never edited here.
      </p>
      <div style={{ marginBottom: 12 }}>
        {(["sources", "create", "retrieval", "bible"] as Tab[]).map((t) => (
          <button key={t} style={tab === t ? btn : btnAlt} onClick={() => setTab(t)}>
            {{ sources: "Sources", create: "New source", retrieval: "Retrieval test", bible: "Bible translations" }[t]}
          </button>
        ))}
      </div>
      {msg && <div style={{ ...box, borderColor: msg.ok ? "#16a34a" : "#dc2626" }}>{msg.text}</div>}
      {tab === "sources" && <Sources note={note} />}
      {tab === "create" && <Create note={note} onDone={() => setTab("sources")} />}
      {tab === "retrieval" && <RetrievalTest note={note} />}
      {tab === "bible" && <Bible note={note} />}
    </main>
  );
}

function Sources({ note }: { note: (ok: boolean, t: string) => void }) {
  const [list, setList] = useState<Source[]>([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (type) q.set("sourceType", type);
    if (search) q.set("search", search);
    try { setList((await api(`/api/admin/knowledge/sources?${q}`)).sources); } catch (e: any) { note(false, e.message); }
  }, [status, type, search, note]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={box}>
        <input style={input} placeholder="Search title" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={input} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select style={input} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All source types</option>{TYPES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {list.length === 0 && <p>No sources match.</p>}
      {list.map((s) => (
        <div key={s.id} style={box}>
          <div onClick={() => setOpenId(openId === s.id ? null : s.id)} style={{ cursor: "pointer" }}>
            <strong>{s.title}</strong> <span style={{ color: "#71717a" }}>v{s.version}{s.isCurrentProduction ? " · LIVE" : ""}</span>
            <div style={{ marginTop: 6 }}>
              <span style={pill(s.approvalStatus)}>{s.approvalStatus}</span>
              <span style={pill(s.licenseStatus)}>{s.licenseStatus}</span>
              <span style={pill("")}>{s.sourceType}</span>
              <span style={pill("")}>trust: {s.trustLevel}</span>
            </div>
          </div>
          {openId === s.id && <Detail id={s.id} note={note} reload={load} />}
        </div>
      ))}
    </div>
  );
}

function Detail({ id, note, reload }: { id: string; note: (ok: boolean, t: string) => void; reload: () => void }) {
  const [src, setSrc] = useState<Source | null>(null);
  const [chunks, setChunks] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [license, setLicense] = useState("");
  const [licenseNotes, setLicenseNotes] = useState("");
  const [trust, setTrust] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/admin/knowledge/sources/${id}`);
      setSrc(d.source); setLicense(d.source.licenseStatus); setLicenseNotes(d.source.licenseNotes ?? ""); setTrust(d.source.trustLevel);
      setChunks(await api(`/api/admin/knowledge/sources/${id}/chunks`));
      setHist(await api(`/api/admin/knowledge/sources/${id}/history`));
    } catch (e: any) { note(false, e.message); }
  }, [id, note]);
  useEffect(() => { load(); }, [load]);

  async function run(label: string, path: string, method: string, body?: unknown) {
    try { await api(path, method, body); note(true, `${label} done`); setReason(""); await load(); reload(); }
    catch (e: any) { note(false, e.message); }
  }
  if (!src) return <p>Loading…</p>;
  const base = `/api/admin/knowledge/sources/${id}`;
  const st = src.approvalStatus;

  return (
    <div style={{ marginTop: 12, fontSize: 14 }}>
      <p>Author: {src.author ?? "—"} · Org: {src.organization ?? "—"} · Language: {src.language}<br />
        Copyright: {src.copyrightInfo ?? "none recorded"}<br />Source URL: {src.sourceUrl ?? "—"}<br />
        Created {new Date(src.createdAt).toLocaleString()} · Updated {new Date(src.updatedAt).toLocaleString()}</p>
      {src.rejectionReason && <p style={{ color: "#b91c1c" }}>Rejection reason: {src.rejectionReason}</p>}

      <h4>Ingestion</h4>
      {chunks && (
        <p>{chunks.ingestion.chunkCount} chunks · {chunks.ingestion.totalChars} chars · embeddings: {JSON.stringify(chunks.ingestion.embeddingCounts)}<br />
          <em>{chunks.ingestion.note}</em></p>
      )}
      {chunks?.blockers?.length > 0 && <ul style={{ color: "#b91c1c" }}>{chunks.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul>}
      {chunks?.chunks?.slice(0, 3).map((c: any) => <pre key={c.id} style={{ whiteSpace: "pre-wrap", background: "#f4f4f5", padding: 8, borderRadius: 6 }}>#{c.chunkIndex}: {c.content}</pre>)}

      <h4>Licence & trust</h4>
      <select style={input} value={license} onChange={(e) => setLicense(e.target.value)}>{LICENSES.map((l) => <option key={l}>{l}</option>)}</select>
      <input style={input} placeholder="Licence notes" value={licenseNotes} onChange={(e) => setLicenseNotes(e.target.value)} />
      <select style={input} value={trust} onChange={(e) => setTrust(e.target.value)}>{TRUST.map((l) => <option key={l}>{l}</option>)}</select>
      <button style={btnAlt} onClick={() => run("Save", base, "PATCH", { licenseStatus: license, licenseNotes, trustLevel: trust })}>
        Save{st === "APPROVED" ? " (creates new DRAFT version)" : ""}
      </button>

      <h4>Workflow</h4>
      <input style={input} placeholder="Reason (required for reject / archive)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {st === "DRAFT" && <button style={btn} onClick={() => run("Submit", `${base}/submit`, "POST", {})}>Submit for review</button>}
      {st === "UNDER_REVIEW" && <button style={btn} onClick={() => run("Approve", `${base}/approve`, "POST", {})}>Approve</button>}
      {st === "UNDER_REVIEW" && <button style={btnAlt} onClick={() => run("Reject", `${base}/reject`, "POST", { reason })}>Reject</button>}
      {st !== "ARCHIVED" && <button style={btnAlt} onClick={() => run("Archive", `${base}/archive`, "POST", { reason })}>Archive</button>}
      {st === "ARCHIVED" && <button style={btn} onClick={() => run("Restore", `${base}/restore`, "POST", {})}>Restore to DRAFT</button>}

      <h4>History</h4>
      {hist?.versions?.map((v: any) => <div key={v.id}>v{v.version} — {v.approvalStatus}{v.isCurrentProduction ? " (live)" : ""}</div>)}
      <div style={{ maxHeight: 160, overflow: "auto", marginTop: 8 }}>
        {hist?.audit?.map((a: any) => <div key={a.id} style={{ fontSize: 12, color: "#52525b" }}>{new Date(a.createdAt).toLocaleString()} — {a.action}{a.metadata?.reason ? `: ${a.metadata.reason}` : ""}</div>)}
      </div>
    </div>
  );
}

function Create({ note, onDone }: { note: (ok: boolean, t: string) => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ sourceType: "TEACHING", trustLevel: "UNVERIFIED", licenseStatus: "LICENSE_REQUIRES_REVIEW", language: "en" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    try { const r = await api("/api/admin/knowledge/sources", "POST", f); note(true, `Created DRAFT with ${r.chunkCount} chunks. It is not live until reviewed and approved.`); onDone(); }
    catch (e: any) { note(false, e.message); }
  }
  return (
    <div style={box}>
      <input style={input} placeholder="Title *" onChange={set("title")} />
      <input style={input} placeholder="Author" onChange={set("author")} />
      <input style={input} placeholder="Organization" onChange={set("organization")} />
      <select style={input} value={f.sourceType} onChange={set("sourceType")}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      <input style={input} placeholder="Description" onChange={set("description")} />
      <input style={input} placeholder="Copyright information (leave blank if unknown)" onChange={set("copyrightInfo")} />
      <select style={input} value={f.licenseStatus} onChange={set("licenseStatus")}>{LICENSES.map((t) => <option key={t}>{t}</option>)}</select>
      <input style={input} placeholder="Source URL" onChange={set("sourceUrl")} />
      <select style={input} value={f.trustLevel} onChange={set("trustLevel")}>{TRUST.map((t) => <option key={t}>{t}</option>)}</select>
      <textarea style={{ ...input, minHeight: 160 }} placeholder="Plain-text content (treated as untrusted data)" onChange={set("rawContent")} />
      <button style={btn} onClick={submit}>Create draft</button>
    </div>
  );
}

function RetrievalTest({ note }: { note: (ok: boolean, t: string) => void }) {
  const [q, setQ] = useState("");
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { setR(await api("/api/admin/knowledge/retrieval-test", "POST", { question: q })); } catch (e: any) { note(false, e.message); }
    setBusy(false);
  }
  return (
    <div>
      <div style={box}>
        <textarea style={{ ...input, minHeight: 70 }} placeholder="Enter a member-style question" value={q} onChange={(e) => setQ(e.target.value)} />
        <button style={btn} disabled={busy || !q.trim()} onClick={run}>{busy ? "Running…" : "Run retrieval test"}</button>
        <div style={{ fontSize: 12, color: "#52525b" }}>Runs the real pipeline without calling an AI provider.</div>
      </div>
      {r && (
        <>
          <div style={box}><strong>Classification:</strong> {r.classification} · Safety triggered: {String(r.safety?.triggered)}</div>
          <div style={box}>
            <strong>Scripture</strong><br />
            translation {r.scripture.translationId ?? "none"} · success {String(r.scripture.retrievalSuccess)} · method {r.scripture.method ?? "—"} · passages {r.scripture.passageCount}
          </div>
          <div style={box}>
            <strong>Knowledge candidates ({r.knowledge.consideredCount})</strong>
            {r.knowledge.considered.map((c: any) => (
              <div key={c.chunkId} style={{ marginTop: 8, fontSize: 13 }}>
                <span style={pill(c.eligible ? "APPROVED" : "REJECTED")}>{c.eligible ? "ELIGIBLE" : "EXCLUDED"}</span>
                {c.title} v{c.version} · {c.sourceType} · {c.approvalStatus}
                {c.excludedBecause && <div style={{ color: "#b91c1c" }}>Why: {c.excludedBecause}</div>}
                <div style={{ color: "#52525b" }}>{c.preview}</div>
              </div>
            ))}
            <p><strong>Selected for context:</strong> {r.knowledge.selected.length}</p>
            {r.knowledge.failures.length > 0 && <p style={{ color: "#b91c1c" }}>Failures: {r.knowledge.failures.join("; ")}</p>}
          </div>
          {r.finalContext && <div style={box}><strong>Final context</strong><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{r.finalContext}</pre></div>}
        </>
      )}
    </div>
  );
}

function Bible({ note }: { note: (ok: boolean, t: string) => void }) {
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => { try { setD(await api("/api/admin/ai-pastor/translations")); } catch (e: any) { note(false, e.message); } }, [note]);
  useEffect(() => { load(); }, [load]);
  async function sync() { try { const r = await api("/api/admin/ai-pastor/translations", "POST"); note(true, `Synced ${r.synced} translations`); load(); } catch (e: any) { note(false, e.message); } }
  async function patch(id: string, body: unknown) { try { await api(`/api/admin/ai-pastor/translations/${id}`, "PATCH", body); note(true, "Updated"); load(); } catch (e: any) { note(false, e.message); } }
  if (!d) return <p>Loading…</p>;
  return (
    <div>
      <div style={box}>Provider status: <strong>{d.providerStatus}</strong> · Default translation: {d.defaultTranslationId ?? "none selected"}<br />
        <button style={btn} onClick={sync}>Sync catalog from provider</button></div>
      {d.translations.map((t: any) => (
        <div key={t.id} style={box}>
          <strong>{t.name}</strong> ({t.abbreviation ?? t.id}) · {t.languageName ?? t.language}
          <div><span style={pill(t.isEnabled ? "APPROVED" : "ARCHIVED")}>{t.isEnabled ? "ENABLED" : "DISABLED"}</span><span style={pill(t.licenseStatus)}>{t.licenseStatus}</span></div>
          <button style={btnAlt} onClick={() => patch(t.id, { isEnabled: !t.isEnabled })}>{t.isEnabled ? "Disable" : "Enable"}</button>
          <select style={input} value={t.licenseStatus} onChange={(e) => patch(t.id, { licenseStatus: e.target.value })}>{LICENSES.map((l) => <option key={l}>{l}</option>)}</select>
        </div>
      ))}
    </div>
  );
}
