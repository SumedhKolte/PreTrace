import { Agent, fetch, type Response } from "undici";
import { sleep, withRetry } from "../../lib/async";
import { logger } from "../../lib/logger";
import { assertUrlAllowed, BlockedUrlError, makeGuardedLookup, type NetworkPolicy } from "./urlSafety";

export type FetchErrorKind =
  | "BLOCKED"
  | "INVALID_URL"
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP_STATUS"
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS";

export class FetchError extends Error {
  constructor(
    readonly kind: FetchErrorKind,
    message: string,
    readonly url: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
  get retryable() {
    if (this.kind === "TIMEOUT" || this.kind === "NETWORK") return true;
    if (this.kind === "HTTP_STATUS") return this.status === 429 || this.status === 408 || (this.status ?? 0) >= 500;
    return false;
  }
}

export interface FetchOptions {
  accept?: "html" | "text" | "xml" | "json";
  maxBytes?: number;
  /** When content exceeds maxBytes: truncate (default for pages) or fail. */
  oversize?: "truncate" | "fail";
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export interface FetchResult {
  url: string;
  requestedUrl: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  truncated: boolean;
  redirects: string[];
}

const ACCEPT_TYPES: Record<NonNullable<FetchOptions["accept"]>, RegExp> = {
  html: /^(text\/html|application\/xhtml\+xml|text\/plain)/i,
  text: /^text\//i,
  xml: /^(application|text)\/(xml|rss\+xml|atom\+xml)|^text\/plain/i,
  json: /^application\/(json|.*\+json)/i,
};

export interface FetcherConfig {
  policy: NetworkPolicy;
  timeoutMs: number;
  maxBytes: number;
  retries: number;
  hostDelayMs: number;
  userAgent?: string;
  /** Test hook to avoid real waiting during backoff. */
  sleepFn?: (ms: number) => Promise<void>;
}

const MAX_REDIRECTS = 5;
export const USER_AGENT = "PrepTraceResearchBot/1.0 (+interview-prep research; respects robots.txt)";

/**
 * Hardened HTTP client used for every outbound request made on behalf of a user.
 * - SSRF: pre-flight URL check + connect-time IP validation + per-hop redirect re-validation
 * - Limits: timeout, byte cap (streamed, never buffered beyond cap), content-type allowlist
 * - Resilience: retry with exponential backoff + jitter on transient failures, Retry-After aware
 * - Politeness: minimum delay between requests to the same host
 * Response bodies are returned as inert text; nothing is ever executed.
 */
export class SafeFetcher {
  private readonly agent: Agent;
  private readonly hostNextSlot = new Map<string, number>();

  constructor(readonly cfg: FetcherConfig) {
    this.agent = new Agent({
      connect: { lookup: makeGuardedLookup(cfg.policy) as never, timeout: cfg.timeoutMs },
      headersTimeout: cfg.timeoutMs,
      bodyTimeout: cfg.timeoutMs,
    });
  }

  async fetch(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const retries = opts.retries ?? this.cfg.retries;
    return withRetry((attempt) => this.fetchOnce(rawUrl, opts, attempt), {
      retries,
      baseDelayMs: 400,
      maxDelayMs: 8000,
      shouldRetry: (e) => e instanceof FetchError && e.retryable,
      delayHintMs: (e) => (e instanceof FetchError ? e.retryAfterMs : undefined),
      onRetry: (e, attempt, delay) => logger.debug("fetch retry", { url: rawUrl, attempt, delay, err: String(e) }),
      sleepFn: this.cfg.sleepFn,
    });
  }

  private async throttleHost(host: string) {
    if (this.cfg.hostDelayMs <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.hostNextSlot.get(host) ?? 0);
    this.hostNextSlot.set(host, slot + this.cfg.hostDelayMs);
    await sleep(slot - now);
  }

  private async fetchOnce(rawUrl: string, opts: FetchOptions, _attempt: number): Promise<FetchResult> {
    const redirects: string[] = [];
    let current = rawUrl;
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const maxBytes = opts.maxBytes ?? this.cfg.maxBytes;
    const acceptRe = ACCEPT_TYPES[opts.accept ?? "html"];

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let url: URL;
      try {
        url = await assertUrlAllowed(current, this.cfg.policy);
      } catch (e) {
        if (e instanceof BlockedUrlError) {
          throw new FetchError(e.reason === "syntax" ? "INVALID_URL" : "BLOCKED", e.message, current);
        }
        throw e;
      }
      await this.throttleHost(url.host);

      let res: Response;
      try {
        res = await fetch(url, {
          dispatcher: this.agent,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "user-agent": this.cfg.userAgent ?? USER_AGENT,
            accept: opts.accept === "json" ? "application/json" : "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
            "accept-language": "en",
            ...opts.headers,
          },
        });
      } catch (e) {
        throw this.classifyNetworkError(e, current);
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) throw new FetchError("HTTP_STATUS", `Redirect without location`, current, res.status);
        current = new URL(loc, url).toString();
        redirects.push(current);
        continue; // re-validated at the top of the loop
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        const ra = res.headers.get("retry-after");
        const retryAfterMs = ra ? (Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : undefined;
        throw new FetchError("HTTP_STATUS", `HTTP ${res.status}`, current, res.status, retryAfterMs);
      }

      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (contentType && !acceptRe.test(contentType)) {
        await res.body?.cancel().catch(() => {});
        throw new FetchError("UNSUPPORTED_TYPE", `Unsupported content type ${contentType}`, current, res.status);
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes && opts.oversize === "fail") {
        await res.body?.cancel().catch(() => {});
        throw new FetchError("TOO_LARGE", `Response too large (${declared} bytes)`, current, res.status);
      }

      const { text, bytes, truncated } = await readCapped(res, maxBytes, current, timeoutMs);
      if (truncated && opts.oversize === "fail") throw new FetchError("TOO_LARGE", `Response exceeded ${maxBytes} bytes`, current);
      return { url: current, requestedUrl: rawUrl, status: res.status, contentType, body: text, bytes, truncated, redirects };
    }
    throw new FetchError("TOO_MANY_REDIRECTS", "Too many redirects", rawUrl);
  }

  private classifyNetworkError(e: unknown, url: string): FetchError {
    if (e instanceof FetchError) return e;
    const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string; message?: string } };
    const code = err.cause?.code ?? err.code;
    if (code === "EBLOCKED" || err.cause?.name === "BlockedUrlError") {
      return new FetchError("BLOCKED", "Blocked connection to non-public address", url);
    }
    if (err.name === "TimeoutError" || err.name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") {
      return new FetchError("TIMEOUT", "Request timed out", url);
    }
    return new FetchError("NETWORK", `Network error${code ? ` (${code})` : ""}`, url);
  }

  async close() {
    await this.agent.close().catch(() => {});
  }
}

async function readCapped(res: Response, maxBytes: number, url: string, timeoutMs: number) {
  if (!res.body) return { text: "", bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      if (Date.now() > deadline) throw new FetchError("TIMEOUT", "Body read timed out", url);
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - bytes));
        bytes = maxBytes;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError("NETWORK", "Connection interrupted while reading body", url);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), bytes, truncated };
}
