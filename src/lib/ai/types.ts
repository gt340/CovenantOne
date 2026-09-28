// Capability-aware AI provider contracts (Phase 16 amendment §2).
//
// Text, image and video are SEPARATE interfaces on purpose: a provider only
// implements what it genuinely supports, and anything else is reported as
// unsupported rather than pretended. Bible retrieval is not here at all —
// Scripture comes from BibleProvider (src/lib/bibleProvider.ts), never from
// a generative model.

export type Capability =
  | "generateText"
  | "generateStructuredResponse"
  | "generateImage"
  | "generateVideo"
  | "analyzeImage"
  | "embed"
  | "moderate";

export type ProviderState = "READY" | "NOT_CONFIGURED" | "UNAVAILABLE" | "ERROR" | "UNSUPPORTED";

export type HealthResult = { state: ProviderState; detail?: string };

export class UnsupportedCapabilityError extends Error {
  constructor(public provider: string, public capability: Capability) {
    super(`${provider} does not support ${capability}`);
    this.name = "UnsupportedCapabilityError";
  }
}

export class ProviderHttpError extends Error {
  constructor(public provider: string, public status: number, message: string) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export type TextRequest = {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
};
export type TextResult = { text: string; model: string; usage?: { inputTokens: number; outputTokens: number } };

export type ImageRequest = { prompt: string };
export type ImageResult = { data: Uint8Array; mimeType: string; model: string };

export type VideoStartResult = { operationRef: string; model: string };
export type VideoPollResult =
  | { done: false }
  | { done: true; ok: true; data: Uint8Array; mimeType: string }
  | { done: true; ok: false; error: string };

interface BaseProvider {
  readonly name: string;
  readonly capabilities: readonly Capability[];
  /** Cheap, non-generating check (lists models). Must never spend generation credits. */
  healthCheck(): Promise<HealthResult>;
  listModels(): Promise<string[]>;
}

export interface TextProvider extends BaseProvider {
  generateText(req: TextRequest): Promise<TextResult>;
}
export interface ImageProvider extends BaseProvider {
  generateImage(req: ImageRequest): Promise<ImageResult>;
}
/** Video is asynchronous: start returns an operation reference, poll checks it. */
export interface VideoProvider extends BaseProvider {
  startVideo(req: { prompt: string }): Promise<VideoStartResult>;
  pollVideo(operationRef: string): Promise<VideoPollResult>;
}

export function assertSupports(provider: { name: string; capabilities: readonly Capability[] }, capability: Capability): void {
  if (!provider.capabilities.includes(capability)) throw new UnsupportedCapabilityError(provider.name, capability);
}

/**
 * Removes credentials from any string headed for logs/responses. Provider
 * error bodies sometimes echo a partial key ("Incorrect API key provided:
 * sk-abc***"), so both the exact configured secret and common key shapes
 * are scrubbed.
 */
export function redactSecrets(message: string, ...secrets: (string | undefined)[]): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[REDACTED]");
  return out.replace(/sk-[A-Za-z0-9_\-*]{6,}/g, "[REDACTED]").replace(/AIza[0-9A-Za-z_\-]{10,}/g, "[REDACTED]");
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export const defaultFetch: FetchFn = (input, init) => fetch(input, init);

export async function callProvider(
  fetchFn: FetchFn,
  provider: string,
  url: string,
  init: RequestInit,
  secrets: string[]
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (err) {
    throw new ProviderHttpError(provider, 0, redactSecrets(`${provider} network error: ${err instanceof Error ? err.message : "unknown"}`, ...secrets));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderHttpError(provider, res.status, redactSecrets(`${provider} API error ${res.status}: ${body.slice(0, 200)}`, ...secrets));
  }
  return res;
}

export function healthFromError(err: unknown): HealthResult {
  if (err instanceof ProviderHttpError) {
    if (err.status === 0 || err.status >= 500) return { state: "UNAVAILABLE", detail: err.message };
    return { state: "ERROR", detail: err.message };
  }
  return { state: "ERROR", detail: "unexpected error" };
}
