import { GeminiImageProvider, GeminiProvider, GeminiVideoProvider } from "./gemini";
import { OpenAIImageProvider, OpenAIProvider } from "./openai";
import type { Capability, FetchFn, ImageProvider, ProviderState, TextProvider, VideoProvider } from "./types";

// Provider selection (Phase 16 amendment §13). Precedence for every value:
//   1. deployment environment variable   (TEXT_PROVIDER, OPENAI_MODEL, ...)
//   2. admin setting stored in ai_pastor_settings
//   3. built-in default (providers only — models have NO default, on purpose)
// Nothing here ever returns or logs a secret; only the *names* of env vars.

export type Kind = "text" | "image" | "video";

export type ProviderSettings = {
  textProvider?: string | null;
  imageProvider?: string | null;
  videoProvider?: string | null;
  textModel?: string | null;
  imageModel?: string | null;
  videoModel?: string | null;
} | null;

/** What each provider actually implements per kind. Anything absent is UNSUPPORTED — not faked. */
export const SUPPORT_MATRIX: Record<string, Partial<Record<Kind, readonly Capability[]>>> = {
  openai: { text: ["generateText"], image: ["generateImage"] },
  gemini: { text: ["generateText"], image: ["generateImage"], video: ["generateVideo"] },
};

const DEFAULT_PROVIDER: Record<Kind, string> = { text: "openai", image: "openai", video: "gemini" };
const PROVIDER_ENV: Record<Kind, string> = { text: "TEXT_PROVIDER", image: "IMAGE_PROVIDER", video: "VIDEO_PROVIDER" };
const SETTINGS_PROVIDER_KEY = { text: "textProvider", image: "imageProvider", video: "videoProvider" } as const;
const SETTINGS_MODEL_KEY = { text: "textModel", image: "imageModel", video: "videoModel" } as const;

const KEY_ENV: Record<string, string> = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };
const MODEL_ENV: Record<string, Partial<Record<Kind, string>>> = {
  openai: { text: "OPENAI_MODEL", image: "OPENAI_IMAGE_MODEL" },
  gemini: { text: "GEMINI_MODEL", image: "GEMINI_IMAGE_MODEL", video: "GEMINI_VIDEO_MODEL" },
};

export type ResolvedProvider = {
  kind: Kind;
  provider: string;
  model: string | null;
  modelSource: "env" | "admin" | "none";
  state: ProviderState; // READY here means "configured"; live reachability is the health check's job
  detail?: string;
  capabilities: readonly Capability[];
  keyEnvVar: string | null; // the NAME of the env var, never its value
};

function clean(v: string | undefined | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function resolveProvider(kind: Kind, settings: ProviderSettings): ResolvedProvider {
  const provider = (clean(process.env[PROVIDER_ENV[kind]]) ?? clean(settings?.[SETTINGS_PROVIDER_KEY[kind]]) ?? DEFAULT_PROVIDER[kind]).toLowerCase();
  const capabilities = SUPPORT_MATRIX[provider]?.[kind] ?? [];
  const keyEnvVar = KEY_ENV[provider] ?? null;

  const modelEnvName = MODEL_ENV[provider]?.[kind];
  const envModel = modelEnvName ? clean(process.env[modelEnvName]) : null;
  const adminModel = clean(settings?.[SETTINGS_MODEL_KEY[kind]]);
  const model = envModel ?? adminModel;
  const modelSource: ResolvedProvider["modelSource"] = envModel ? "env" : adminModel ? "admin" : "none";

  const base = { kind, provider, model, modelSource, capabilities, keyEnvVar };

  if (!SUPPORT_MATRIX[provider]) return { ...base, state: "UNSUPPORTED", detail: `Unknown provider "${provider}".` };
  if (capabilities.length === 0) return { ...base, state: "UNSUPPORTED", detail: `${provider} does not support ${kind} generation in this system.` };
  if (!keyEnvVar || !clean(process.env[keyEnvVar])) return { ...base, state: "NOT_CONFIGURED", detail: `${keyEnvVar} is not set.` };
  if (!model) return { ...base, state: "NOT_CONFIGURED", detail: "No model selected. Set it in the admin screen or the deployment environment." };
  return { ...base, state: "READY" };
}

export function describeAll(settings: ProviderSettings) {
  return { text: resolveProvider("text", settings), image: resolveProvider("image", settings), video: resolveProvider("video", settings) };
}

// Factories return null unless the provider is configured, so callers must
// handle the "not available" case explicitly.
export function getTextProvider(settings: ProviderSettings, fetchFn?: FetchFn): TextProvider | null {
  const r = resolveProvider("text", settings);
  if (r.state !== "READY") return null;
  const key = process.env[r.keyEnvVar!]!.trim();
  if (r.provider === "openai") return new OpenAIProvider(key, r.model!, undefined, fetchFn);
  if (r.provider === "gemini") return new GeminiProvider(key, r.model!, undefined, fetchFn);
  return null;
}

export function getImageProvider(settings: ProviderSettings, fetchFn?: FetchFn): ImageProvider | null {
  const r = resolveProvider("image", settings);
  if (r.state !== "READY") return null;
  const key = process.env[r.keyEnvVar!]!.trim();
  if (r.provider === "openai") return new OpenAIImageProvider(key, r.model!, undefined, fetchFn);
  if (r.provider === "gemini") return new GeminiImageProvider(key, r.model!, undefined, fetchFn);
  return null;
}

export function getVideoProvider(settings: ProviderSettings, fetchFn?: FetchFn): VideoProvider | null {
  const r = resolveProvider("video", settings);
  if (r.state !== "READY") return null;
  const key = process.env[r.keyEnvVar!]!.trim();
  if (r.provider === "gemini") return new GeminiVideoProvider(key, r.model!, undefined, fetchFn);
  return null;
}

/** Providers an admin may pick for each kind (used to validate admin input). */
export function supportedProviders(kind: Kind): string[] {
  return Object.keys(SUPPORT_MATRIX).filter((p) => (SUPPORT_MATRIX[p][kind]?.length ?? 0) > 0);
}
