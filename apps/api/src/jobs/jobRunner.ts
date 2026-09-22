import { Types } from "mongoose";
import {
  PIPELINE_STAGES,
  REGENERATE_STAGES,
  type GenerationStatus,
  type JobEvent,
  type RegenerateScope,
  type StageState,
  type StageStatus,
} from "@preptrace/shared";
import { GenerationJob, Kit, type JobDoc } from "../db/models";
import { mutateKit } from "../kits/repository";
import { runRegeneration } from "../kits/regeneration";
import { RequestQueue } from "../lib/async";
import { AppError, toSafeError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { Services } from "../services";

/**
 * Long-running generation never blocks an HTTP request:
 *   POST creates a job (queued) → this runner executes it in-process with bounded
 *   concurrency → the UI polls GET /generation-status for stage-by-stage progress.
 * Jobs are persisted, so progress survives page reloads; jobs interrupted by a server
 * restart are marked failed with a retry option.
 */

function initialStages(type: "generate" | "regenerate", scope?: RegenerateScope): StageState[] {
  const defs = type === "generate" ? PIPELINE_STAGES : REGENERATE_STAGES[scope as RegenerateScope] ?? [];
  return defs.map((d) => ({ key: d.key, label: d.label, status: "pending" as StageStatus }));
}

function progressOf(stages: StageState[]): number {
  if (stages.length === 0) return 0;
  const done = stages.filter((s) => s.status === "done" || s.status === "skipped").length;
  const running = stages.filter((s) => s.status === "running").length;
  return Math.min(99, Math.round(((done + running * 0.5) / stages.length) * 100));
}

export function toStatusDTO(j: JobDoc): GenerationStatus {
  return {
    jobId: j._id.toString(),
    kitId: j.kitId.toString(),
    type: j.type as GenerationStatus["type"],
    scope: (j.scope ?? undefined) as RegenerateScope | undefined,
    status: j.status as GenerationStatus["status"],
    progress: j.progress ?? 0,
    currentStage: j.currentStage ?? undefined,
    stages: (j.stages ?? []) as StageState[],
    events: ((j.events ?? []) as JobEvent[]).slice(-60),
    error: j.error?.code ? { code: j.error.code, message: j.error.message ?? "" } : undefined,
    createdAt: new Date(j.createdAt).toISOString(),
    startedAt: j.startedAt ? new Date(j.startedAt).toISOString() : undefined,
    finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : undefined,
  };
}

class JobProgress {
  stages: StageState[];
  private events: JobEvent[] = [];
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly jobId: Types.ObjectId,
    type: "generate" | "regenerate",
    scope?: RegenerateScope,
  ) {
    this.stages = initialStages(type, scope);
  }

  report = (key: string, status: StageStatus, detail?: string) => {
    const now = new Date().toISOString();
    let stage = this.stages.find((s) => s.key === key);
    if (!stage) {
      stage = { key, label: key, status: "pending" };
      this.stages.push(stage);
    }
    // Earlier stages still "running" are complete once a later stage starts.
    const idx = this.stages.indexOf(stage);
    if (status === "running") for (const s of this.stages.slice(0, idx)) if (s.status === "running") [s.status, s.finishedAt] = ["done", now];
    if (status === "running" && !stage.startedAt) stage.startedAt = now;
    if (status === "done" || status === "skipped" || status === "failed") stage.finishedAt = now;
    stage.status = status;
    if (detail) stage.detail = detail;
    if (detail) this.events.push({ at: now, stage: key, message: detail, level: status === "failed" ? "error" : "info" });
    this.flush();
  };

  private flush() {
    const stages = this.stages.map((s) => ({ ...s }));
    const events = this.events.splice(0);
    const running = stages.find((s) => s.status === "running");
    this.pending = this.pending.then(() =>
      GenerationJob.updateOne(
        { _id: this.jobId },
        {
          $set: { stages, progress: progressOf(stages), currentStage: running?.key ?? null },
          ...(events.length ? { $push: { events: { $each: events, $slice: -150 } } } : {}),
        },
      ).catch((e) => logger.warn("progress write failed", { err: String(e) })),
    );
  }

  async settle() {
    await this.pending;
  }
}

export class JobRunner {
  private readonly queue: RequestQueue;
  private readonly active = new Set<string>();

  constructor(
    private readonly services: Services,
    concurrency: number,
  ) {
    this.queue = new RequestQueue(concurrency);
  }

  async createJob(args: {
    kitId: Types.ObjectId;
    userId: Types.ObjectId;
    type: "generate" | "regenerate";
    scope?: RegenerateScope;
    options?: Record<string, unknown>;
  }) {
    const running = await GenerationJob.exists({ kitId: args.kitId, status: { $in: ["queued", "running"] } });
    if (running) throw new AppError("JOB_IN_PROGRESS", "A generation is already running for this kit.");
    const job = await GenerationJob.create({ ...args, stages: initialStages(args.type, args.scope) });
    this.enqueue(job._id.toString());
    return job;
  }

  enqueue(jobId: string) {
    if (this.active.has(jobId)) return;
    this.active.add(jobId);
    void this.queue
      .run(() => this.execute(jobId))
      .catch((e) => logger.error("job crashed", { jobId, err: String(e) }))
      .finally(() => this.active.delete(jobId));
  }

  /** On boot: re-queue queued jobs; mark jobs that were mid-flight as interrupted. */
  async recover() {
    const interrupted = await GenerationJob.find({ status: "running" }).lean<JobDoc[]>();
    for (const j of interrupted) {
      await GenerationJob.updateOne(
        { _id: j._id },
        { $set: { status: "failed", finishedAt: new Date(), error: { code: "GENERATION_FAILED", message: "Generation was interrupted by a server restart. Please retry." } } },
      );
      if (j.type === "generate") {
        await Kit.updateOne({ _id: j.kitId }, { $set: { status: "failed", error: { code: "GENERATION_FAILED", message: "Generation was interrupted. Please retry." } }, $inc: { rev: 1 } });
      }
    }
    const queued = await GenerationJob.find({ status: "queued" }).sort({ createdAt: 1 }).lean<JobDoc[]>();
    for (const j of queued) this.enqueue(j._id.toString());
    if (interrupted.length || queued.length) logger.info("job recovery", { interrupted: interrupted.length, requeued: queued.length });
  }

  private async execute(jobId: string) {
    const job = await GenerationJob.findOneAndUpdate(
      { _id: jobId, status: "queued" },
      { $set: { status: "running", startedAt: new Date() } },
      { returnDocument: "after" },
    ).lean<JobDoc>();
    if (!job) return;
    const kitId = job.kitId.toString();
    const userId = job.userId.toString();
    const progress = new JobProgress(job._id, job.type as "generate" | "regenerate", (job.scope ?? undefined) as RegenerateScope | undefined);

    try {
      if (job.type === "generate") {
        const kit = await Kit.findById(job.kitId).lean<{ input: { jd: string; companyUrl: string; days: number } }>();
        if (!kit) throw new AppError("NOT_FOUND", "Kit not found.");
        const out = await this.services.pipeline.generate(kit.input, progress.report);
        await mutateKit(kitId, userId, (k) => {
          Object.assign(k, out.parts);
          k.generation = { ...out.parts.generation, jobId };
          k.counters = { ...out.counters, generation: 0 };
          k.status = out.partial ? "partial" : "ready";
          k.error = null;
        });
        await progress.settle();
        await GenerationJob.updateOne({ _id: job._id }, { $set: { status: out.partial ? "partial" : "completed", progress: 100, finishedAt: new Date(), currentStage: null } });
      } else {
        const res = await runRegeneration(this.services, kitId, userId, job.scope as RegenerateScope, progress.report, job.options ?? {});
        await progress.settle();
        await GenerationJob.updateOne(
          { _id: job._id },
          {
            $set: { status: "completed", progress: 100, finishedAt: new Date(), currentStage: null },
            $push: { events: { at: new Date().toISOString(), stage: "done", message: res.summary, level: "info" } },
          },
        );
      }
    } catch (e) {
      const safe = toSafeError(e);
      logger.warn("job failed", { jobId, code: safe.code, err: e instanceof Error ? e.message : String(e) });
      const running = progress.stages.find((s) => s.status === "running");
      if (running) progress.report(running.key, "failed", safe.message);
      await progress.settle();
      await GenerationJob.updateOne({ _id: job._id }, { $set: { status: "failed", finishedAt: new Date(), error: safe, currentStage: null } });
      if (job.type === "generate") {
        await Kit.updateOne({ _id: job.kitId }, { $set: { status: "failed", error: safe }, $inc: { rev: 1 } });
      }
    }
  }
}
