/** Provider-agnostic LLM interface. Swap providers without touching the pipeline. */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  /** Stable task name (e.g. "jd_analysis") — used for logging, metrics and test doubles. */
  task: string;
  messages: LlmMessage[];
  json: boolean;
  /** JSON Schema for structured outputs (constrained decoding) where the provider supports it. */
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
}

export interface LlmResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export type LlmErrorKind = "rate_limited" | "unavailable" | "timeout" | "auth" | "bad_request" | "invalid_response";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
  get retryable() {
    return this.kind === "rate_limited" || this.kind === "unavailable" || this.kind === "timeout";
  }
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}
