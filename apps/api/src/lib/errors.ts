import type { ErrorCode } from "@preptrace/shared";

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  INVALID_INPUT: 400,
  INVALID_URL: 400,
  URL_NOT_ALLOWED: 400,
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  DUPLICATE_KIT: 409,
  JOB_IN_PROGRESS: 409,
  VERSION_CONFLICT: 409,
  RATE_LIMITED: 429,
  LLM_NOT_CONFIGURED: 503,
};

/**
 * Structured application error. `message` is always safe to show to users:
 * never include stack traces, secrets, file paths or infrastructure details.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, opts: { details?: unknown; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code] ?? 500;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Convert anything thrown into a safe {code, message} pair. */
export function toSafeError(e: unknown, fallback: ErrorCode = "GENERATION_FAILED"): { code: ErrorCode; message: string } {
  if (isAppError(e)) return { code: e.code, message: e.message };
  return { code: fallback, message: "An unexpected error occurred while generating the kit." };
}
