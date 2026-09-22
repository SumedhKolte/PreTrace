/** Concurrency, rate-limiting and retry primitives shared by the crawler and LLM client. */

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });

/**
 * FIFO request queue with a concurrency cap and a minimum interval between
 * task *starts* (turns a requests-per-minute budget into even spacing).
 */
export class RequestQueue {
  private active = 0;
  private lastStart = 0;
  private waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly minIntervalMs = 0,
  ) {}

  get pending() {
    return this.waiting.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire() {
    if (this.active >= this.concurrency) {
      await new Promise<void>((r) => this.waiting.push(r));
    } else {
      this.active++;
    }
    if (this.minIntervalMs > 0) {
      const now = Date.now();
      const next = Math.max(now, this.lastStart + this.minIntervalMs);
      this.lastStart = next;
      await sleep(next - now);
    }
  }

  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Return false to stop retrying immediately. */
  shouldRetry: (err: unknown, attempt: number) => boolean;
  /** Server-provided delay hint (e.g. Retry-After) takes precedence over backoff. */
  delayHintMs?: (err: unknown) => number | undefined;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  random?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

/** Exponential backoff with full jitter: delay = random(0.5..1) * min(max, base * 2^attempt). */
export function backoffDelay(attempt: number, base: number, max: number, random = Math.random): number {
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.round(exp * (0.5 + random() * 0.5));
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const doSleep = opts.sleepFn ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.retries || !opts.shouldRetry(err, attempt)) throw err;
      const hint = opts.delayHintMs?.(err);
      const delay = hint !== undefined ? Math.min(hint, opts.maxDelayMs) : backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs, opts.random);
      opts.onRetry?.(err, attempt + 1, delay);
      await doSleep(delay);
    }
  }
}

/** Map with bounded concurrency, preserving input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), ms);
    }),
  ]);
}
