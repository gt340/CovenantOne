"use client";

import { useState, useEffect, useCallback } from "react";

type Resolved = { provider: string; model: string | null; modelSource: string; state: string; detail?: string; capabilities: string[]; keyEnvVar: string | null };
type Config = {
  providers: { text: Resolved; image: Resolved; video: Resolved };
  supported: { text: string[]; image: string[]; video: string[] };
  bibleDefaultTranslationId: string | null;
  availableTranslations: { id: string; name: string; abbreviation: string | null; languageName: string | null }[];
  mediaMode: string;
  mediaModes: string[];
  rateLimits: Record<string, { perMinute: number; perDay: number; maxConcurrent?: number }>;
  textFallbackEnabled: boolean;
};
type Health = { bible: HealthEntry; text: HealthEntry; image: HealthEntry; video: HealthEntry; checkedAt: string };
type HealthEntry = { state: string; detail?: string; provider?: string; model?: string | null };
type Usage = {
  windowDays: number;
  totalRequests: number;
  successRate: number | null;
  fallbackUsedCount: number;
  avgLatencyMs: number | null;
  byProvider: Record<string, number>;
  byRequestType: Record<string, number>;
  safety: { total: number; byType: Record<string, number>; recent: { eventType: string; createdAt: string }[] };
  media: Record<string, number>;
};

const STATE_STYLE: Record<string, string> = {
  READY: "text-green-600",
  CONNECTED: "text-green-600",
  NOT_CONFIGURED: "text-amber-600",
  UNSUPPORTED: "text-gray-400",
  UNAVAILABLE: "text-red-600",
  ERROR: "text-red-600",
};

export default function AIPastorAdminPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [textModel, setTextModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [videoModel, setVideoModel] = useState("");
  const [translationId, setTranslationId] = useState("");
  const [mediaMode, setMediaMode] = useState("OFF");
  const [textFallbackEnabled, setTextFallbackEnabled] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/ai-pastor/config", { credentials: "include" });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error ?? `Request failed (${res.status})`);
      return;
    }
    const data: Config = await res.json();
    setConfig(data);
    setTextModel(data.providers.text.model ?? "");
    setImageModel(data.providers.image.model ?? "");
    setVideoModel(data.providers.video.model ?? "");
    setTranslationId(data.bibleDefaultTranslationId ?? "");
    setMediaMode(data.mediaMode);
    setTextFallbackEnabled(data.textFallbackEnabled);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/admin/ai-pastor/usage", { credentials: "include" }).then(async (r) => r.ok && setUsage(await r.json()));
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
    const body: Record<string, unknown> = { mediaMode, textFallbackEnabled };
    if (textModel.trim()) body.textModel = textModel.trim();
    if (imageModel.trim()) body.imageModel = imageModel.trim();
    if (videoModel.trim()) body.videoModel = videoModel.trim();
    if (translationId) body.bibleDefaultTranslationId = translationId;
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
      <p className="text-sm text-gray-500 mb-6">API keys are set in the deployment environment and are never shown here.</p>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {config && (
        <>
          <Section title="Bible provider (API.Bible)">
            <Row label="Connection" value={health ? health.bible.state : "Not checked"} style={health ? STATE_STYLE[health.bible.state] : ""} />
            {health?.bible.detail && <div className="text-xs text-red-600">{health.bible.detail}</div>}
            <Row label="Default translation" value={config.bibleDefaultTranslationId ?? "NOT SELECTED"} />
            <button onClick={syncTranslations} disabled={busy} className="mt-2 text-sm px-3 py-1.5 border rounded-md disabled:opacity-40">
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
            {config.availableTranslations.length === 0 && <div className="text-xs text-gray-400 mt-1">No translations loaded yet — sync once BIBLE_API_KEY is set.</div>}
          </Section>

          <ProviderSection title="Text provider (AI Pastor reasoning)" resolved={config.providers.text} health={health?.text} model={textModel} setModel={setTextModel} />

          <Section title="Fallback (Phase 17 §20)">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={textFallbackEnabled} onChange={(e) => setTextFallbackEnabled(e.target.checked)} />
              If the primary text provider fails, automatically try the other configured provider
            </label>
            <p className="text-xs text-gray-400 mt-1">Only helps when a second provider (OpenAI or Gemini) has both a key and a model set. Never used to bypass NOT_CONFIGURED.</p>
          </Section>

          <ProviderSection title="Image provider" resolved={config.providers.image} health={health?.image} model={imageModel} setModel={setImageModel} />
          <ProviderSection title="Video provider" resolved={config.providers.video} health={health?.video} model={videoModel} setModel={setVideoModel} />

          <Section title="Media policy">
            <label className="block text-xs text-gray-500 mb-1">Mode</label>
            <select value={mediaMode} onChange={(e) => setMediaMode(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
              {config.mediaModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              OFF: never generate. SELECTIVE: only on explicit request. IMAGE: explicit + offer button on teaching topics. IMAGE_AND_VIDEO: adds explicit video requests.
            </p>
          </Section>

          <Section title="Rate limits (per member)">
            {(["TEXT", "IMAGE", "VIDEO"] as const).map((k) => (
              <Row key={k} label={k} value={`${config.rateLimits[k]?.perMinute}/min · ${config.rateLimits[k]?.perDay}/day${config.rateLimits[k]?.maxConcurrent ? ` · ${config.rateLimits[k].maxConcurrent} concurrent` : ""}`} />
            ))}
          </Section>

          {usage && (
            <Section title={`Usage (last ${usage.windowDays} days)`}>
              <Row label="Total requests" value={String(usage.totalRequests)} />
              <Row label="Success rate" value={usage.successRate !== null ? `${usage.successRate}%` : "—"} />
              <Row label="Used fallback provider" value={String(usage.fallbackUsedCount)} />
              <Row label="Avg latency" value={usage.avgLatencyMs !== null ? `${usage.avgLatencyMs} ms` : "—"} />
              {Object.keys(usage.byProvider).length > 0 && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">By provider</div>
                  {Object.entries(usage.byProvider).map(([p, n]) => (
                    <Row key={p} label={p} value={String(n)} />
                  ))}
                </div>
              )}
              {Object.keys(usage.media).length > 0 && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">Media jobs</div>
                  {Object.entries(usage.media).map(([k, n]) => (
                    <Row key={k} label={k} value={String(n)} />
                  ))}
                </div>
              )}
            </Section>
          )}

          {usage && (
            <Section title="Safety events">
              <Row label="Total (7d)" value={String(usage.safety.total)} />
              {Object.entries(usage.safety.byType).map(([t, n]) => (
                <Row key={t} label={t.replace(/_/g, " ")} value={String(n)} />
              ))}
              {usage.safety.total === 0 && <div className="text-xs text-gray-400">None in this window.</div>}
              <p className="text-xs text-gray-400 mt-2">Type and timestamp only — no conversation content is shown here.</p>
            </Section>
          )}

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

function ProviderSection({
  title,
  resolved,
  health,
  model,
  setModel,
}: {
  title: string;
  resolved: Resolved;
  health?: HealthEntry;
  model: string;
  setModel: (v: string) => void;
}) {
  return (
    <Section title={title}>
      <Row label="Selected provider" value={resolved.provider} />
      <Row label="Configuration" value={resolved.state} style={STATE_STYLE[resolved.state]} />
      {resolved.detail && resolved.state !== "READY" && <div className="text-xs text-amber-600">{resolved.detail}</div>}
      <Row label="Connection" value={health ? health.state : "Not checked"} style={health ? STATE_STYLE[health.state] : ""} />
      {health?.detail && <div className="text-xs text-red-600">{health.detail}</div>}
      {resolved.keyEnvVar && <Row label="Required env var" value={resolved.keyEnvVar} />}
      {resolved.capabilities.length === 0 && <div className="text-xs text-gray-400">This provider does not support this capability.</div>}
      {resolved.capabilities.length > 0 && (
        <>
          <label className="block text-xs text-gray-500 mt-2">Model {resolved.modelSource === "env" ? "(set by environment — overrides this field)" : ""}</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} disabled={resolved.modelSource === "env"} placeholder="e.g. gpt-4o" className="w-full border rounded-md px-3 py-2 text-sm disabled:bg-gray-50" />
        </>
      )}
    </Section>
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
