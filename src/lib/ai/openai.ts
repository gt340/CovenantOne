import {
  callProvider,
  defaultFetch,
  healthFromError,
  type Capability,
  type FetchFn,
  type HealthResult,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  type TextProvider,
  type TextRequest,
  type TextResult,
} from "./types";

const DEFAULT_BASE = "https://api.openai.com/v1";

function authHeaders(apiKey: string) {
  return { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
}

async function listOpenAIModels(fetchFn: FetchFn, baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await callProvider(fetchFn, "openai", `${baseUrl}/models`, { headers: authHeaders(apiKey) }, [apiKey]);
  const json = await res.json();
  return ((json.data ?? []) as { id: string }[]).map((m) => m.id).sort();
}

/** OpenAI as an AI Pastor REASONING provider. Never a source of Scripture. */
export class OpenAIProvider implements TextProvider {
  readonly name = "openai";
  readonly capabilities: readonly Capability[] = ["generateText"];

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string = DEFAULT_BASE,
    private fetchFn: FetchFn = defaultFetch
  ) {}

  async generateText(req: TextRequest): Promise<TextResult> {
    const res = await callProvider(
      this.fetchFn,
      "openai",
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: authHeaders(this.apiKey),
        body: JSON.stringify({
          model: this.model,
          max_completion_tokens: req.maxTokens ?? 1024,
          messages: [{ role: "system", content: req.system }, ...req.messages],
        }),
      },
      [this.apiKey]
    );
    const json = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("openai returned no content");
    return {
      text,
      model: json.model ?? this.model,
      usage: json.usage ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens } : undefined,
    };
  }

  listModels() {
    return listOpenAIModels(this.fetchFn, this.baseUrl, this.apiKey);
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      await this.listModels();
      return { state: "READY" };
    } catch (err) {
      return healthFromError(err);
    }
  }
}

export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  readonly capabilities: readonly Capability[] = ["generateImage"];

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string = DEFAULT_BASE,
    private fetchFn: FetchFn = defaultFetch
  ) {}

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const res = await callProvider(
      this.fetchFn,
      "openai",
      `${this.baseUrl}/images/generations`,
      { method: "POST", headers: authHeaders(this.apiKey), body: JSON.stringify({ model: this.model, prompt: req.prompt, n: 1 }) },
      [this.apiKey]
    );
    const json = await res.json();
    const item = json.data?.[0];
    if (item?.b64_json) return { data: new Uint8Array(Buffer.from(item.b64_json, "base64")), mimeType: "image/png", model: this.model };
    if (item?.url) {
      const img = await callProvider(this.fetchFn, "openai", item.url, {}, [this.apiKey]);
      return { data: new Uint8Array(await img.arrayBuffer()), mimeType: img.headers.get("content-type") ?? "image/png", model: this.model };
    }
    throw new Error("openai image response contained no image");
  }

  listModels() {
    return listOpenAIModels(this.fetchFn, this.baseUrl, this.apiKey);
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      await this.listModels();
      return { state: "READY" };
    } catch (err) {
      return healthFromError(err);
    }
  }
}
