import type { AppConfig } from "../config/env";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

/**
 * Adapter for any OpenAI-compatible Chat Completions endpoint. Gemini, Groq and
 * OpenRouter all expose one, so a single adapter covers every free-tier option.
 */
export const PROVIDER_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(
    private readonly opts: {
      name: string;
      apiKey: string;
      baseUrl: string;
      model: string;
      timeoutMs: number;
      reasoningEffort?: string;
    },
  ) {
    this.name = opts.name;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
    };
    if (req.json) body.response_format = { type: "json_object" };
    if (this.opts.reasoningEffort) body.reasoning_effort = this.opts.reasoningEffort;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      const name = (e as Error).name;
      if (name === "TimeoutError" || name === "AbortError") throw new LlmError("timeout", "LLM request timed out");
      throw new LlmError("unavailable", "LLM provider could not be reached");
    }

    if (!res.ok) {
      // Never surface provider bodies verbatim to users (may echo request data); keep a short reason for logs.
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), detail);
      if (res.status === 429) throw new LlmError("rate_limited", "LLM rate limit reached", retryAfter);
      if (res.status === 401 || res.status === 403) throw new LlmError("auth", "LLM API key was rejected");
      if (res.status >= 500 || res.status === 408) throw new LlmError("unavailable", `LLM provider error (HTTP ${res.status})`, retryAfter);
      throw new LlmError("bad_request", `LLM request rejected (HTTP ${res.status}): ${detail.replace(/\s+/g, " ").slice(0, 160)}`);
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const text = data?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new LlmError("invalid_response", "LLM returned an empty response");
    return { text, usage: { inputTokens: data?.usage?.prompt_tokens, outputTokens: data?.usage?.completion_tokens } };
  }
}

function parseRetryAfter(header: string | null, body: string): number | undefined {
  if (header && Number.isFinite(Number(header))) return Number(header) * 1000;
  // Gemini reports e.g. "retryDelay": "17s" in the error body.
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body) ?? /try again in (\d+(?:\.\d+)?)s/i.exec(body);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

export function createProviderFromConfig(cfg: AppConfig): LlmProvider | null {
  if (!cfg.LLM_API_KEY) return null;
  const preset = PROVIDER_PRESETS[cfg.LLM_PROVIDER];
  const baseUrl = cfg.LLM_BASE_URL || preset?.baseUrl;
  const model = cfg.LLM_MODEL || preset?.model;
  if (!baseUrl || !model) throw new Error("LLM_BASE_URL and LLM_MODEL are required for the custom provider");
  return new OpenAICompatibleProvider({
    name: cfg.LLM_PROVIDER,
    apiKey: cfg.LLM_API_KEY,
    baseUrl,
    model,
    timeoutMs: cfg.LLM_TIMEOUT_MS,
    reasoningEffort: cfg.LLM_REASONING_EFFORT || undefined,
  });
}
