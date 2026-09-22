import type { ApiErrorBody } from "@preptrace/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Same-origin JSON client. Requests go to /api/* on this origin and are proxied to
 * the Express backend by next.config.ts rewrites, so the session cookie is first-party.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      signal: init.signal,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status >= 500 && !err) throw new ApiError(res.status, "INTERNAL_ERROR", "The server is unavailable. Is the API running?");
    throw new ApiError(res.status, err?.code ?? "INTERNAL_ERROR", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const fetcher = <T,>(path: string) => api<T>(path);
