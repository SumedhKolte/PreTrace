import { createHmac, randomBytes } from "node:crypto";
import type { CookieOptions, Response } from "express";
import type { Types } from "mongoose";
import { getConfig } from "../config/env";
import { Session, User } from "../db/models";

export const SESSION_COOKIE = "pt_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Server-side sessions: the cookie holds a random 256-bit token; the database only
 * stores HMAC-SHA256(SESSION_SECRET, token), so a leaked sessions collection cannot
 * be replayed. Sessions expire (TTL index) and are revoked on logout.
 */
export function hashToken(token: string): string {
  return createHmac("sha256", getConfig().SESSION_SECRET).update(token).digest("hex");
}

export function cookieOptions(): CookieOptions {
  const cfg = getConfig();
  const secure = cfg.NODE_ENV === "production" || cfg.COOKIE_SAMESITE === "none";
  return {
    httpOnly: true,
    secure,
    sameSite: cfg.COOKIE_SAMESITE,
    path: "/",
    maxAge: cfg.SESSION_TTL_HOURS * 3_600_000,
  };
}

export async function createSession(userId: Types.ObjectId | string, res: Response, userAgent?: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + getConfig().SESSION_TTL_HOURS * 3_600_000);
  await Session.create({ tokenHash: hashToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 200) });
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export async function resolveSession(token: string | undefined): Promise<AuthUser | null> {
  if (!token || token.length > 200) return null;
  const session = await Session.findOne({ tokenHash: hashToken(token) }).lean();
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  const user = await User.findById(session.userId).lean();
  if (!user) return null;
  return { id: user._id.toString(), email: user.email, name: user.name };
}

export async function destroySession(token: string | undefined, res: Response) {
  if (token) await Session.deleteOne({ tokenHash: hashToken(token) });
  const { maxAge: _maxAge, ...opts } = cookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
}
