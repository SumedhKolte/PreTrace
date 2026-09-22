import { Router } from "express";
import rateLimit from "express-rate-limit";
import { LoginSchema, RegisterSchema } from "@preptrace/shared";
import { User } from "../db/models";
import { ah, parseBody, requireAuth, authedUser } from "../http/middleware";
import { AppError } from "../lib/errors";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, SESSION_COOKIE } from "./sessions";

export function authRouter() {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: process.env.NODE_ENV === "test" ? 1000 : 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes.")),
  });

  r.post(
    "/register",
    limiter,
    ah(async (req, res) => {
      const body = parseBody(RegisterSchema, req.body);
      if (await User.exists({ email: body.email })) throw new AppError("EMAIL_TAKEN", "An account with this email already exists.");
      const user = await User.create({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password) }).catch((e) => {
        if ((e as { code?: number }).code === 11000) throw new AppError("EMAIL_TAKEN", "An account with this email already exists.");
        throw e;
      });
      await createSession(user._id, res, req.get("user-agent"));
      res.status(201).json({ user: { id: user._id.toString(), email: user.email, name: user.name } });
    }),
  );

  r.post(
    "/login",
    limiter,
    ah(async (req, res) => {
      const body = parseBody(LoginSchema, req.body);
      const user = await User.findOne({ email: body.email });
      // Always run the KDF so response time does not reveal whether the email exists.
      const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) throw new AppError("INVALID_CREDENTIALS", "Incorrect email or password.");
      await createSession(user._id, res, req.get("user-agent"));
      res.json({ user: { id: user._id.toString(), email: user.email, name: user.name } });
    }),
  );

  r.post(
    "/logout",
    ah(async (req, res) => {
      await destroySession(req.cookies?.[SESSION_COOKIE], res);
      res.json({ ok: true });
    }),
  );

  r.get(
    "/me",
    requireAuth,
    ah(async (req, res) => {
      res.json({ user: authedUser(req) });
    }),
  );

  return r;
}
