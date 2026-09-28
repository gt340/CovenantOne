"use client";

import { useState, useEffect, useCallback } from "react";

type Config = {
  bibleProvider: { name: string; credentials: "CONFIGURED" | "NOT_CONFIGURED" };
  aiProvider: { name: string; credentials: "CONFIGURED" | "NOT_CONFIGURED" };
  defaultTranslationId: string | null;
  aiModel: string | null;
  availableTranslations: { id: string; name: string; abbreviation: string | null; languageName: string | null }[];
};

type Health = {
  bible: { status: "NOT_CONFIGURED" | "CONNECTED" | "ERROR"; detail?: string };
  ai: { status: "NOT_CONFIGURED" | "CONNECTED" | "ERROR"; detail?: string };
  checkedAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  NOT_CONFIGURED: "text-amber-600",
  CONFIGURED: "text-blue-600",
  CONNECTED: "text-green-600",
  ERROR: "text-red-600",
};

export default function AIPastorAdminPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const [translationId, setTranslationId] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/ai-pastor/config", { credentials: "include" });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error ?? `Request failed (${res.status})`);
      return;
    }
    const data: Config = await res.json();
    setConfig(data);
    setModel(data.aiModel ?? "");
    setTranslationId(data.defaultTranslationId ?? "");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runHealthCheck() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/ai-pastor/health", { credentials: "include" });
    if (res.ok) setHealth(await res.json());
    else setError("Health check failed to run.");
    setBusy(false);
  }

  async function syncTranslations() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/ai-pastor/translations", { method: "POST", credentials: "include" });
    const b = await res.json().catch(() => null);
    if (!res.ok) setError(b?.error ?? `Sync failed (${res.status})`);
    await load();
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, string> = {};
    if (model.trim()) body.aiModel = model.trim();
    if (translationId) body.defaultTranslationId = translationId;
    const res = await fetch("/api/admin/ai-pastor/config", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error ?? `Save failed (${res.status})`);
    }
    await load();
    setBusy(false);
  }

  if (!config && !error) return <div className="text-center text-gray-400 py-12">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">AI Pastor — Configuration</h1>
      <p className="text-sm text-gray-500 mb-6">
        API keys are set in the deployment environment and are never shown here.
      </p>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {config && (
        <>
          <Section title="Bible provider">
            <Row label="Provider" value={config.bibleProvider.name} />
            <Row label="Credentials" value={config.bibleProvider.credentials} style={STATUS_STYLE[config.bibleProvider.credentials]} />
            <Row label="Connection" value={health ? health.bible.status : "Not checked"} style={health ? STATUS_STYLE[health.bible.status] : ""} />
            {health?.bible.detail && <div className="text-xs text-red-600">{health.bible.detail}</div>}
            <Row label="Default translation" value={config.defaultTranslationId ?? "NOT SELECTED"} />
            <button onClick={syncTranslations} disabled={busy || config.bibleProvider.credentials === "NOT_CONFIGURED"} className="mt-2 text-sm px-3 py-1.5 border rounded-md disabled:opacity-40">
              Sync available translations
            </button>
            <select value={translationId} onChange={(e) => setTranslationId(e.target.value)} className="mt-2 w-full border rounded-md px-3 py-2 text-sm">
              <option value="">Select a default translation</option>
              {config.availableTranslations.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.abbreviation ? `(${t.abbreviation})` : ""} {t.languageName ? `· ${t.languageName}` : ""}
                </option>
              ))}
            </select>
            {config.availableTranslations.length === 0 && (
              <div className="text-xs text-gray-400 mt-1">No translations loaded yet — connect the provider, then sync.</div>
            )}
          </Section>

          <Section title="AI provider">
            <Row label="Provider" value={config.aiProvider.name} />
            <Row label="Credentials" value={config.aiProvider.credentials} style={STATUS_STYLE[config.aiProvider.credentials]} />
            <Row label="Connection" value={health ? health.ai.status : "Not checked"} style={health ? STATUS_STYLE[health.ai.status] : ""} />
            {health?.ai.detail && <div className="text-xs text-red-600">{health.ai.detail}</div>}
            <label className="block text-xs text-gray-500 mt-2">Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
          </Section>

          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
              Save
            </button>
            <button onClick={runHealthCheck} disabled={busy} className="px-4 py-2 text-sm rounded-md border disabled:opacity-50">
              Run health check
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-md p-4 mb-4 space-y-1">
      <h2 className="text-sm font-medium mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value, style }: { label: string; value: string; style?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={style ?? ""}>{value}</span>
    </div>
  );
}
