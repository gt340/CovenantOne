// AI provider abstraction (Phase 16 §2/§3). The AI Pastor's reasoning layer
// only — never the source of Scripture itself (see bibleProvider.ts). Model
// name is configurable (ai_pastor_settings.aiModel), never hard-coded
// through the app.

export type AIMessage = { role: "user" | "assistant"; content: string };

export type AIGenerateRequest = {
  system: string;
  messages: AIMessage[];
  maxTokens?: number;
};

export type AIGenerateResult = {
  text: string;
  model: string;
  stopReason: string | null;
  usage?: { inputTokens: number; outputTokens: number };
};

export interface AIProvider {
  readonly name: string;
  generate(req: AIGenerateRequest): Promise<AIGenerateResult>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

export type AIProviderStatus = "NOT_CONFIGURED" | "CONFIGURED";

/**
 * Env var is ANTHROPIC_API_KEY, matching the actual chosen provider
 * (Anthropic) — the Phase 16 spec's example var name (OPENAI_API_KEY)
 * appears to be a copy-paste artifact from a different provider's template
 * and would be actively misleading here, so it was not used. Flagged in the
 * Phase 16 completion report.
 */
export function aiProviderStatus(): AIProviderStatus {
  return process.env.ANTHROPIC_API_KEY ? "CONFIGURED" : "NOT_CONFIGURED";
}

export function getAIProvider(model?: string): AIProvider | null {
  if (aiProviderStatus() === "NOT_CONFIGURED") return null;
  const { AnthropicProvider } = require("./aiProviders/anthropicProvider");
  return new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6");
}
