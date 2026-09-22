import type { ZodType } from "zod";
import { RequestQueue, withRetry } from "../lib/async";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { LlmError, type LlmMessage, type LlmProvider } from "./provider";

export interface JsonTask<T> {
  task: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmClientOptions {
  concurrency: number;
  maxRpm: number;
  retries: number;
  maxTokens: number;
  temperature: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface LlmStats {
  calls: number;
  retries: number;
  repairs: number;
  failures: number;
  byTask: Record<string, number>;
}

const newStats = (): LlmStats => ({ calls: 0, retries: 0, repairs: 0, failures: 0, byTask: {} });

/** Pull the JSON payload out of a model response (tolerates code fences and chatter). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new LlmError("invalid_response", "Response was not valid JSON");
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 12)
    .map((i) => `- ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

/**
 * The only way the pipeline talks to a model.
 *  - One shared FIFO queue: bounded concurrency + RPM spacing (free tiers throttle).
 *  - Transient failures (429/5xx/timeout) retried with exponential backoff + jitter,
 *    honouring provider retry hints.
 *  - Output is never trusted: parse → Zod schema → one repair round-trip with the
 *    validation errors → structured LLM_INVALID_RESPONSE if still invalid.
 */
export class LlmClient {
  private readonly queue: RequestQueue;
  readonly stats = newStats();

  constructor(
    private readonly provider: LlmProvider | null,
    private readonly opts: LlmClientOptions,
  ) {
    this.queue = new RequestQueue(opts.concurrency, opts.maxRpm > 0 ? Math.ceil(60_000 / opts.maxRpm) : 0);
  }

  get available() {
    return this.provider !== null;
  }
  get providerName() {
    return this.provider?.name ?? "none";
  }
  get model() {
    return this.provider?.model ?? "none";
  }

  /** Per-run view that counts calls for generation metadata. */
  scope(): ScopedLlm {
    return new ScopedLlm(this);
  }

  async json<T>(t: JsonTask<T>, stats: LlmStats = this.stats): Promise<T> {
    if (!this.provider) {
      throw new AppError("LLM_NOT_CONFIGURED", "No LLM provider is configured. Set LLM_API_KEY (see .env.example).");
    }
    const messages: LlmMessage[] = [
      { role: "system", content: t.system },
      { role: "user", content: t.user },
    ];
    const first = await this.call(t, messages, stats);
    let parsed: unknown;
    let problem: string;
    try {
      parsed = extractJson(first);
      const ok = t.schema.safeParse(parsed);
      if (ok.success) return ok.data;
      problem = formatIssues(ok.error.issues);
    } catch {
      problem = "- The response was not valid JSON.";
    }

    // Repair round-trip: show the model its own output and the exact validation errors.
    stats.repairs++;
    if (this.stats !== stats) this.stats.repairs++;
    logger.warn("llm output invalid, attempting repair", { task: t.task, problem: problem.slice(0, 300) });
    const repairMessages: LlmMessage[] = [
      ...messages,
      { role: "assistant", content: first.slice(0, 12_000) },
      {
        role: "user",
        content: `Your previous response did not match the required JSON schema:\n${problem}\n\nReturn ONLY the corrected JSON object. Do not add commentary.`,
      },
    ];
    const second = await this.call(t, repairMessages, stats);
    try {
      const ok = t.schema.safeParse(extractJson(second));
      if (ok.success) return ok.data;
      problem = formatIssues(ok.error.issues);
    } catch {
      problem = "not valid JSON";
    }
    stats.failures++;
    throw new AppError("LLM_INVALID_RESPONSE", `The AI model returned an invalid response for step "${t.task}".`, {
      details: problem.slice(0, 500),
    });
  }

  private async call(t: JsonTask<unknown>, messages: LlmMessage[], stats: LlmStats): Promise<string> {
    const provider = this.provider!;
    try {
      return await withRetry(
        async () => {
          const res = await this.queue.run(() =>
            provider.complete({
              task: t.task,
              messages,
              json: true,
              maxTokens: t.maxTokens ?? this.opts.maxTokens,
              temperature: t.temperature ?? this.opts.temperature,
            }),
          );
          stats.calls++;
          stats.byTask[t.task] = (stats.byTask[t.task] ?? 0) + 1;
          if (stats !== this.stats) this.stats.calls++;
          return res.text;
        },
        {
          retries: this.opts.retries,
          baseDelayMs: 1500,
          maxDelayMs: 60_000,
          shouldRetry: (e) => e instanceof LlmError && e.retryable,
          delayHintMs: (e) => (e instanceof LlmError && e.retryAfterMs ? e.retryAfterMs + 250 : undefined),
          onRetry: (e, attempt, delay) => {
            stats.retries++;
            logger.warn("llm retry", { task: t.task, attempt, delay, reason: (e as Error).message });
          },
          sleepFn: this.opts.sleepFn,
        },
      );
    } catch (e) {
      stats.failures++;
      if (e instanceof LlmError) {
        if (e.kind === "rate_limited") throw new AppError("LLM_RATE_LIMITED", "The AI provider's rate limit was reached. Please retry in a minute.", { retryable: true });
        if (e.kind === "auth") throw new AppError("LLM_NOT_CONFIGURED", "The AI provider rejected the configured API key.");
        if (e.kind === "invalid_response") throw new AppError("LLM_INVALID_RESPONSE", `The AI model returned an empty response for step "${t.task}".`);
        throw new AppError("LLM_UNAVAILABLE", "The AI provider is temporarily unavailable. Please retry.", { retryable: true });
      }
      throw e;
    }
  }
}

export class ScopedLlm {
  readonly stats = newStats();
  constructor(private readonly client: LlmClient) {}
  get available() {
    return this.client.available;
  }
  get providerName() {
    return this.client.providerName;
  }
  get model() {
    return this.client.model;
  }
  json<T>(t: JsonTask<T>): Promise<T> {
    return this.client.json(t, this.stats);
  }
}

export type Llm = Pick<ScopedLlm, "json" | "available" | "providerName" | "model">;
