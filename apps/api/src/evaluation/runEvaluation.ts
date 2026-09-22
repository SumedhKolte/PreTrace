import { BatchCaseSchema, BatchKitEntrySchema, type BatchKitEntry, type BatchOutput } from "@preptrace/shared";
import { mapLimit, withTimeout } from "../lib/async";
import { AppError, toSafeError } from "../lib/errors";
import type { Services } from "../services";
import { validateCanonicalKit } from "../validation/kitValidator";

export interface EvaluationOptions {
  caseConcurrency: number;
  caseTimeoutMs: number;
  log?: (line: string) => void;
}

function describeCase(raw: unknown, i: number): string {
  const id = (raw as { id?: unknown })?.id;
  return typeof id === "string" && id ? id : `case-${String(i + 1).padStart(2, "0")}`;
}

/**
 * Batch evaluation: every case goes through the SAME InterviewPrepService pipeline the
 * web app uses (services are built by the same composition root). One failing case never
 * aborts the run — it is recorded as {status:"failed", error:{code,message}}.
 */
export async function runEvaluation(rawCases: unknown[], services: Services, opts: EvaluationOptions): Promise<BatchOutput> {
  const log = opts.log ?? (() => {});
  const entries = await mapLimit(rawCases, Math.max(1, opts.caseConcurrency), async (raw, i): Promise<BatchKitEntry> => {
    const id = describeCase(raw, i);
    const started = Date.now();
    const parsed = BatchCaseSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log(`[${id}] ✗ INVALID_INPUT ${issue?.path.join(".")}: ${issue?.message}`);
      return { id, status: "failed", kit: null, error: { code: "INVALID_INPUT", message: `Invalid case: ${issue?.path.join(".") || "input"} ${issue?.message ?? ""}`.trim() } };
    }
    const c = parsed.data;
    log(`[${id}] ▶ ${c.company_url} · ${c.days} day(s) · JD ${c.jd.length} chars`);
    try {
      const out = await withTimeout(
        services.pipeline.generate({ jd: c.jd, companyUrl: c.company_url, days: c.days }, (stage, status, detail) => {
          if (status === "done" || status === "failed") log(`[${id}] ${status === "done" ? "✓" : "✗"} ${stage}${detail ? ` — ${detail}` : ""}`);
        }),
        opts.caseTimeoutMs,
        () => new AppError("GENERATION_TIMEOUT", `Case exceeded the ${Math.round(opts.caseTimeoutMs / 1000)}s time limit.`),
      );
      const v = validateCanonicalKit(out.canonical, c.days);
      if (!v.ok) throw new AppError("KIT_VALIDATION_FAILED", `Kit failed validation: ${v.errors.slice(0, 3).join("; ")}`);
      const entry: BatchKitEntry = { id, status: "ok", kit: out.canonical, error: null };
      BatchKitEntrySchema.parse(entry);
      log(`[${id}] ● ok in ${((Date.now() - started) / 1000).toFixed(1)}s — ${out.canonical.questions.length} questions, ${out.canonical.flashcards.length} flashcards, coverage passes ${out.canonical.coverage.passes}`);
      return entry;
    } catch (e) {
      const err = toSafeError(e);
      log(`[${id}] ✗ failed in ${((Date.now() - started) / 1000).toFixed(1)}s — ${err.code}: ${err.message}`);
      return { id, status: "failed", kit: null, error: err };
    }
  });
  return { version: "1.0", generated_at: new Date().toISOString(), kits: entries };
}
