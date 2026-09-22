import { Router } from "express";
import rateLimit from "express-rate-limit";
import { CompleteRepairSchema, CritiqueRequestSchema, PracticeEventSchema, StartPracticeSchema, StartRepairSchema } from "@preptrace/shared";
import { ah, authedUser, parseBody } from "../http/middleware";
import { AppError } from "../lib/errors";
import type { PracticeService } from "./practiceService";

/** Mounted under /api/kits/:id — all handlers are ownership-scoped via findOwnedKit. */
export function practiceRouter(practice: PracticeService) {
  const r = Router({ mergeParams: true });
  const kitId = (p: Record<string, string | string[]>) => String(p.id);

  r.get(
    "/weak-spots",
    ah(async (req, res) => {
      const { report } = await practice.readiness(kitId(req.params), authedUser(req).id);
      res.json({ readiness: report });
    }),
  );

  r.get(
    "/practice/recommended",
    ah(async (req, res) => {
      const minutes = Math.min(120, Math.max(5, Number(req.query.minutes ?? 15) || 15));
      const { items } = await practice.recommended(kitId(req.params), authedUser(req).id, minutes, "recommended");
      res.json({ items, estMinutes: items.reduce((a, i) => a + i.estMinutes, 0) });
    }),
  );

  r.get(
    "/practice/stats",
    ah(async (req, res) => {
      const { stats } = await practice.readiness(kitId(req.params), authedUser(req).id);
      res.json({ stats: Object.fromEntries(stats) });
    }),
  );

  r.get(
    "/practice/history",
    ah(async (req, res) => {
      res.json(await practice.history(kitId(req.params), authedUser(req).id));
    }),
  );

  r.post(
    "/practice",
    ah(async (req, res) => {
      const body = parseBody(StartPracticeSchema, req.body);
      res.status(201).json({ session: await practice.startSession(kitId(req.params), authedUser(req).id, body.minutes, body.filter) });
    }),
  );

  r.post(
    "/practice/events",
    ah(async (req, res) => {
      const body = parseBody(PracticeEventSchema, req.body);
      res.status(201).json(await practice.recordEvent(kitId(req.params), authedUser(req).id, body));
    }),
  );

  r.post(
    "/practice/sessions/:sessionId/complete",
    ah(async (req, res) => {
      res.json({ session: await practice.completeSession(kitId(req.params), authedUser(req).id, String(req.params.sessionId)) });
    }),
  );

  // LLM-backed and user-triggered: limited per user to protect the free-tier quota.
  const critiqueLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: process.env.NODE_ENV === "test" ? 1000 : 40,
    keyGenerator: (req) => req.user?.id ?? "anon",
    handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", "You've requested a lot of critiques this hour. Try again shortly.")),
  });

  r.post(
    "/practice/critique",
    critiqueLimiter,
    ah(async (req, res) => {
      const body = parseBody(CritiqueRequestSchema, req.body);
      res.json({ critique: await practice.critique(kitId(req.params), authedUser(req).id, body) });
    }),
  );

  r.post(
    "/weak-spots/repair",
    ah(async (req, res) => {
      const body = parseBody(StartRepairSchema, req.body);
      res.status(201).json(await practice.startRepair(kitId(req.params), authedUser(req).id, body.requirementId));
    }),
  );

  r.post(
    "/weak-spots/repair/:sessionId/complete",
    ah(async (req, res) => {
      const body = parseBody(CompleteRepairSchema, req.body);
      res.json(await practice.completeRepair(kitId(req.params), authedUser(req).id, String(req.params.sessionId), body.confidence));
    }),
  );

  return r;
}
