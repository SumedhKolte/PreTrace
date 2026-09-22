import { Router } from "express";
import rateLimit from "express-rate-limit";
import { Types } from "mongoose";
import {
  CreateBatchSchema,
  CreateFlashcardSchema,
  CreateKitSchema,
  CreateQuestionSchema,
  normalizeJdForKey,
  normalizeUrlForKey,
  parseCompanyUrl,
  RegenerateSchema,
  ReorderSchema,
  UpdateBriefSchema,
  UpdateFlashcardSchema,
  UpdateKitSchema,
  UpdateQuestionSchema,
  UpdateScheduleDaySchema,
  type KitSummary,
} from "@preptrace/shared";
import { GenerationJob, Kit, PracticeEvent, PracticeSession, type JobDoc } from "../db/models";
import { ah, authedUser, parseBody } from "../http/middleware";
import { toStatusDTO, type JobRunner } from "../jobs/jobRunner";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/text";
import { readinessForKits } from "../practice/practiceService";
import { toCanonicalKit } from "./canonical";
import * as edit from "./editing";
import { findOwnedKit, mutateKit, toObjectId, toWorkspace, type KitRecord } from "./repository";
import { reschedule } from "./state";

/** Deterministic idempotency key: SHA-256(normalised JD | normalised company URL). */
export function kitInputHash(jd: string, companyUrl: string) {
  return sha256(`${normalizeJdForKey(jd)}|${normalizeUrlForKey(companyUrl)}`);
}

export function kitsRouter(runner: JobRunner) {
  const r = Router();
  const createLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: process.env.NODE_ENV === "test" ? 1000 : 30,
    keyGenerator: (req) => req.user?.id ?? "anon",
    handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", "Too many kits created recently. Please wait a bit.")),
  });

  // ---- List / create ----------------------------------------------------------

  r.get(
    "/",
    ah(async (req, res) => {
      const user = authedUser(req);
      const userId = toObjectId(user.id);
      const kits = await Kit.find({ userId }).sort({ updatedAt: -1 }).limit(100).lean<KitRecord[]>();
      const readiness = await readinessForKits(kits, userId);
      const jobs = await GenerationJob.find({ kitId: { $in: kits.map((k) => k._id) }, status: { $in: ["queued", "running"] } }).lean<JobDoc[]>();
      const summaries: KitSummary[] = kits.map((k) => {
        const rep = readiness.get(k._id.toString());
        const job = jobs.find((j) => j.kitId.toString() === k._id.toString());
        const interview = new Date(new Date(k.createdAt).getTime() + k.input.days * 86_400_000);
        return {
          id: k._id.toString(),
          status: k.status,
          company: k.source?.company || hostLabel(k.input.companyUrl),
          role: k.role?.title || "Analysing role…",
          companyUrl: k.input.companyUrl,
          days: k.input.days,
          interviewDate: interview.toISOString(),
          readiness: rep?.overall ?? 0,
          weakSpotCount: rep?.weakSpots.length ?? 0,
          questionCount: k.questions.filter((q) => !q.meta.deleted).length,
          flashcardCount: k.flashcards.filter((f) => !f.meta.deleted).length,
          lastPracticedAt: k.lastPracticedAt ? new Date(k.lastPracticedAt).toISOString() : undefined,
          createdAt: new Date(k.createdAt).toISOString(),
          updatedAt: new Date(k.updatedAt).toISOString(),
          job: job ? { status: job.status as "queued" | "running", progress: job.progress ?? 0, currentStage: job.currentStage ?? undefined } : undefined,
        };
      });
      res.json({ kits: summaries });
    }),
  );

  async function createOne(userId: Types.ObjectId, input: { jd: string; companyUrl: string; days: number }, force?: boolean) {
    const url = parseCompanyUrl(input.companyUrl);
    if (!url.ok) throw new AppError("INVALID_URL", url.message);
    const inputHash = kitInputHash(input.jd, url.url);
    if (!force) {
      // Duplicate submission: same JD + company for this user → return the existing kit instead of redoing work.
      const existing = await Kit.findOne({ userId, inputHash, status: { $ne: "failed" } }).sort({ createdAt: -1 }).lean<KitRecord>();
      if (existing) {
        throw new AppError("DUPLICATE_KIT", "You already have a kit for this job description and company.", {
          details: { kitId: existing._id.toString(), status: existing.status },
        });
      }
    }
    const kit = await Kit.create({ userId, status: "generating", input: { jd: input.jd, companyUrl: url.url, days: input.days }, inputHash });
    const job = await runner.createJob({ kitId: kit._id, userId, type: "generate" });
    return { kitId: kit._id.toString(), jobId: job._id.toString() };
  }

  r.post(
    "/",
    createLimiter,
    ah(async (req, res) => {
      const user = authedUser(req);
      const body = parseBody(CreateKitSchema, req.body);
      const out = await createOne(toObjectId(user.id), body, body.force);
      res.status(202).json(out);
    }),
  );

  // Multi-role batch input from the web UI: each case becomes its own kit + job.
  r.post(
    "/batch",
    createLimiter,
    ah(async (req, res) => {
      const user = authedUser(req);
      const body = parseBody(CreateBatchSchema, req.body);
      const results = [];
      for (const c of body.cases) {
        try {
          results.push({ ok: true as const, ...(await createOne(toObjectId(user.id), c, true)) });
        } catch (e) {
          const err = e instanceof AppError ? { code: e.code, message: e.message } : { code: "GENERATION_FAILED", message: "Could not create kit." };
          results.push({ ok: false as const, error: err });
        }
      }
      res.status(202).json({ results });
    }),
  );

  // ---- Read / delete ----------------------------------------------------------

  r.get(
    "/:id",
    ah(async (req, res) => {
      const kit = await findOwnedKit(String(req.params.id), authedUser(req).id);
      res.json({ kit: toWorkspace(kit) });
    }),
  );

  r.get(
    "/:id/export",
    ah(async (req, res) => {
      const kit = await findOwnedKit(String(req.params.id), authedUser(req).id);
      if (!kit.role || !kit.schedule) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
      res.json(toCanonicalKit(toWorkspace(kit)));
    }),
  );

  r.delete(
    "/:id",
    ah(async (req, res) => {
      const kit = await findOwnedKit(String(req.params.id), authedUser(req).id);
      await Promise.all([
        Kit.deleteOne({ _id: kit._id, userId: kit.userId }),
        GenerationJob.deleteMany({ kitId: kit._id }),
        PracticeEvent.deleteMany({ kitId: kit._id, userId: kit.userId }),
        PracticeSession.deleteMany({ kitId: kit._id, userId: kit.userId }),
      ]);
      res.json({ ok: true });
    }),
  );

  // ---- Generation jobs --------------------------------------------------------

  r.post(
    "/:id/generate",
    ah(async (req, res) => {
      const user = authedUser(req);
      const kit = await findOwnedKit(String(req.params.id), user.id);
      await Kit.updateOne({ _id: kit._id }, { $set: { status: "generating", error: null }, $inc: { rev: 1 } });
      const job = await runner.createJob({ kitId: kit._id, userId: kit.userId, type: "generate" });
      res.status(202).json({ jobId: job._id.toString() });
    }),
  );

  r.get(
    "/:id/generation-status",
    ah(async (req, res) => {
      const kit = await findOwnedKit(String(req.params.id), authedUser(req).id);
      const job = await GenerationJob.findOne({ kitId: kit._id }).sort({ createdAt: -1 }).lean<JobDoc>();
      res.json({ status: job ? toStatusDTO(job) : null, kitStatus: kit.status, rev: kit.rev });
    }),
  );

  r.post(
    "/:id/regenerate/:scope",
    ah(async (req, res) => {
      const user = authedUser(req);
      const kit = await findOwnedKit(String(req.params.id), user.id);
      if (kit.status === "generating" || !kit.role) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
      const scopeParam = String(req.params.scope);
      // /regenerate/questions?category=technical is accepted as an alias.
      const scope = scopeParam === "questions" ? String(req.query.category ?? req.body?.category ?? "") : scopeParam;
      const body = parseBody(RegenerateSchema, { ...req.body, scope });
      const job = await runner.createJob({ kitId: kit._id, userId: kit.userId, type: "regenerate", scope: body.scope, options: { replaceEdited: body.replaceEdited ?? false } });
      res.status(202).json({ jobId: job._id.toString() });
    }),
  );

  // ---- Questions -----------------------------------------------------------------

  r.post(
    "/:id/questions",
    ah(async (req, res) => {
      const body = parseBody(CreateQuestionSchema, req.body);
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.createQuestion(k, body));
      res.status(201).json({ question: result, coverage: kit.coverage, rev: kit.rev });
    }),
  );

  r.put(
    "/:id/questions/order",
    ah(async (req, res) => {
      const body = parseBody(ReorderSchema, req.body);
      const { kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => {
        k.questions = edit.reorder(k.questions, body.ids);
      });
      res.json({ ok: true, rev: kit.rev });
    }),
  );

  r.patch(
    "/:id/questions/:qid",
    ah(async (req, res) => {
      const body = parseBody(UpdateQuestionSchema, req.body);
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.updateQuestion(k, String(req.params.qid), body));
      res.json({ question: result, coverage: kit.coverage, rev: kit.rev });
    }),
  );

  r.post(
    "/:id/questions/:qid/pin",
    ah(async (req, res) => {
      const pinned = req.body?.pinned !== false;
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.updateQuestion(k, String(req.params.qid), { pinned }));
      res.json({ question: result, rev: kit.rev });
    }),
  );

  r.delete(
    "/:id/questions/:qid",
    ah(async (req, res) => {
      const { kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.deleteQuestion(k, String(req.params.qid)));
      res.json({ ok: true, coverage: kit.coverage, rev: kit.rev });
    }),
  );

  r.post(
    "/:id/questions/:qid/restore",
    ah(async (req, res) => {
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.restoreQuestion(k, String(req.params.qid)));
      res.json({ question: result, coverage: kit.coverage, rev: kit.rev });
    }),
  );

  // ---- Flashcards ------------------------------------------------------------------

  r.post(
    "/:id/flashcards",
    ah(async (req, res) => {
      const body = parseBody(CreateFlashcardSchema, req.body);
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.createFlashcard(k, body));
      res.status(201).json({ flashcard: result, rev: kit.rev });
    }),
  );

  r.put(
    "/:id/flashcards/order",
    ah(async (req, res) => {
      const body = parseBody(ReorderSchema, req.body);
      const { kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => {
        k.flashcards = edit.reorder(k.flashcards, body.ids);
      });
      res.json({ ok: true, rev: kit.rev });
    }),
  );

  r.patch(
    "/:id/flashcards/:fid",
    ah(async (req, res) => {
      const body = parseBody(UpdateFlashcardSchema, req.body);
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.updateFlashcard(k, String(req.params.fid), body));
      res.json({ flashcard: result, rev: kit.rev });
    }),
  );

  r.delete(
    "/:id/flashcards/:fid",
    ah(async (req, res) => {
      const { kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.deleteFlashcard(k, String(req.params.fid)));
      res.json({ ok: true, rev: kit.rev });
    }),
  );

  // ---- Company brief -----------------------------------------------------------

  r.patch(
    "/:id/company-brief",
    ah(async (req, res) => {
      const body = parseBody(UpdateBriefSchema, req.body);
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.updateBrief(k, body));
      res.json({ companyBrief: result, briefRevisions: kit.briefRevisions, rev: kit.rev });
    }),
  );

  r.post(
    "/:id/company-brief/revisions/:index/restore",
    ah(async (req, res) => {
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.restoreBriefRevision(k, Number(req.params.index)));
      res.json({ companyBrief: result, briefRevisions: kit.briefRevisions, rev: kit.rev });
    }),
  );

  // ---- Schedule -----------------------------------------------------------------

  r.patch(
    "/:id/schedule/days/:day",
    ah(async (req, res) => {
      const body = parseBody(UpdateScheduleDaySchema, req.body);
      const { result, kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => edit.updateScheduleDay(k, Number(req.params.day), body));
      res.json({ day: result, rev: kit.rev });
    }),
  );

  // Kit-level update: change the interview timeline. The schedule is rebuilt
  // deterministically to exactly N days; locked days that still fit are kept.
  r.patch(
    "/:id",
    ah(async (req, res) => {
      const body = parseBody(UpdateKitSchema, req.body);
      const { kit } = await mutateKit(String(req.params.id), authedUser(req).id, (k) => {
        if (!k.schedule || !k.role) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
        k.input = { ...k.input, days: body.days };
        k.schedule = reschedule({ ...k.schedule, days_available: body.days }, k.questions, k.role.requirements, { keepLocked: true }).schedule;
      });
      res.json({ kit: toWorkspace(kit) });
    }),
  );

  return r;
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
