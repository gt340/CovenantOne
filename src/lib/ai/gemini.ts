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
  type VideoPollResult,
  type VideoProvider,
  type VideoStartResult,
} from "./types";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

function headers(apiKey: string) {
  return { "content-type": "application/json", "x-goog-api-key": apiKey };
}

async function listGeminiModels(fetchFn: FetchFn, baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await callProvider(fetchFn, "gemini", `${baseUrl}/models?pageSize=200`, { headers: headers(apiKey) }, [apiKey]);
  const json = await res.json();
  return ((json.models ?? []) as { name: string }[]).map((m) => m.name.replace(/^models\//, "")).sort();
}

async function healthViaModels(fetchFn: FetchFn, baseUrl: string, apiKey: string): Promise<HealthResult> {
  try {
    await listGeminiModels(fetchFn, baseUrl, apiKey);
    return { state: "READY" };
  } catch (err) {
    return healthFromError(err);
  }
}

/** Gemini as an AI Pastor REASONING provider. Never a source of Scripture. */
export class GeminiProvider implements TextProvider {
  readonly name = "gemini";
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
      "gemini",
      `${this.baseUrl}/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: headers(this.apiKey),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: req.maxTokens ?? 1024 },
        }),
      },
      [this.apiKey]
    );
    const json = await res.json();
    const parts: { text?: string }[] = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("");
    if (!text) throw new Error(`gemini returned no content${json.promptFeedback?.blockReason ? ` (blocked: ${json.promptFeedback.blockReason})` : ""}`);
    return {
      text,
      model: this.model,
      usage: json.usageMetadata
        ? { inputTokens: json.usageMetadata.promptTokenCount ?? 0, outputTokens: json.usageMetadata.candidatesTokenCount ?? 0 }
        : undefined,
    };
  }

  listModels() {
    return listGeminiModels(this.fetchFn, this.baseUrl, this.apiKey);
  }
  healthCheck() {
    return healthViaModels(this.fetchFn, this.baseUrl, this.apiKey);
  }
}

/** Image support is model-dependent: a model that can't produce images fails at call time with the provider's own error. */
export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini";
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
      "gemini",
      `${this.baseUrl}/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: headers(this.apiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      },
      [this.apiKey]
    );
    const json = await res.json();
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const inline = imagePart?.inlineData ?? imagePart?.inline_data;
    if (!inline?.data) throw new Error("gemini image response contained no image");
    return {
      data: new Uint8Array(Buffer.from(inline.data, "base64")),
      mimeType: inline.mimeType ?? inline.mime_type ?? "image/png",
      model: this.model,
    };
  }

  listModels() {
    return listGeminiModels(this.fetchFn, this.baseUrl, this.apiKey);
  }
  healthCheck() {
    return healthViaModels(this.fetchFn, this.baseUrl, this.apiKey);
  }
}

/** Asynchronous video. UNVERIFIED against the live API — see the amendment report. */
export class GeminiVideoProvider implements VideoProvider {
  readonly name = "gemini";
  readonly capabilities: readonly Capability[] = ["generateVideo"];

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string = DEFAULT_BASE,
    private fetchFn: FetchFn = defaultFetch
  ) {}

  async startVideo(req: { prompt: string }): Promise<VideoStartResult> {
    const res = await callProvider(
      this.fetchFn,
      "gemini",
      `${this.baseUrl}/models/${this.model}:predictLongRunning`,
      { method: "POST", headers: headers(this.apiKey), body: JSON.stringify({ instances: [{ prompt: req.prompt }] }) },
      [this.apiKey]
    );
    const json = await res.json();
    if (!json.name) throw new Error("gemini video start returned no operation name");
    return { operationRef: json.name, model: this.model };
  }

  async pollVideo(operationRef: string): Promise<VideoPollResult> {
    const res = await callProvider(this.fetchFn, "gemini", `${this.baseUrl}/${operationRef}`, { headers: headers(this.apiKey) }, [this.apiKey]);
    const json = await res.json();
    if (!json.done) return { done: false };
    if (json.error) return { done: true, ok: false, error: String(json.error.message ?? "video generation failed").slice(0, 200) };
    const video = json.response?.generateVideoResponse;
    if (video?.raiMediaFilteredReasons?.length) return { done: true, ok: false, error: "Video was blocked by the provider's safety filters." };
    const uri: string | undefined = video?.generatedSamples?.[0]?.video?.uri;
    if (!uri) return { done: true, ok: false, error: "Provider finished but returned no video." };
    const file = await callProvider(this.fetchFn, "gemini", uri, { headers: { "x-goog-api-key": this.apiKey } }, [this.apiKey]);
    return { done: true, ok: true, data: new Uint8Array(await file.arrayBuffer()), mimeType: "video/mp4" };
  }

  listModels() {
    return listGeminiModels(this.fetchFn, this.baseUrl, this.apiKey);
  }
  healthCheck() {
    return healthViaModels(this.fetchFn, this.baseUrl, this.apiKey);
  }
}
