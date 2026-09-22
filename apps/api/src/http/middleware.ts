import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { resolveSession, SESSION_COOKIE, type AuthUser } from "../auth/sessions";
import { getConfig } from "../config/env";
import { AppError, isAppError } from "../lib/errors";
import { logger } from "../lib/logger";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

/** Wrap async handlers so rejections reach the error middleware (Express 5 also does this natively). */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

/** Requires a valid session. The user id comes ONLY from the server-side session, never the request. */
export const requireAuth: RequestHandler = ah(async (req, _res, next) => {
  const user = await resolveSession(req.cookies?.[SESSION_COOKIE]);
  if (!user) throw new AppError("AUTH_REQUIRED", "Please sign in to continue.");
  req.user = user;
  next();
});

export function authedUser(req: Request): AuthUser {
  if (!req.user) throw new AppError("AUTH_REQUIRED", "Please sign in to continue.");
  return req.user;
}

/**
 * CSRF defence in depth (cookies are also SameSite=Lax): state-changing requests
 * carrying an Origin header must come from an allowed origin.
 */
export const originCheck: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  const cfg = getConfig();
  const allowed = new Set([cfg.FRONTEND_URL, cfg.BACKEND_URL].map((u) => new URL(u).origin));
  if (!allowed.has(origin)) return next(new AppError("FORBIDDEN", "Cross-origin request rejected."));
  next();
};

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AppError("INVALID_INPUT", first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input", {
      details: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return r.data;
}

export const notFound: RequestHandler = (_req, _res, next) => next(new AppError("NOT_FOUND", "Not found."));

/** Structured errors only. Stack traces, paths and provider details never leave the server. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (isAppError(err)) {
    if (err.status >= 500) logger.warn("request failed", { path: req.path, code: err.code });
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.status < 500 && err.details ? { details: err.details } : {}) } });
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "Malformed JSON body." } });
    return;
  }
  if (e?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "INVALID_INPUT", message: "Request body too large." } });
    return;
  }
  logger.error("unhandled error", { path: req.path, err: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
}
