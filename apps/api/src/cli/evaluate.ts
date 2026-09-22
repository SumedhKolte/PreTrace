#!/usr/bin/env node
/**
 * Batch evaluator.
 *
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Reads an array of {id, jd, company_url, days} cases, runs each through the same
 * pipeline as the web app (evaluation network mode: localhost/private company URLs
 * allowed, cloud-metadata/link-local still blocked), and writes Appendix B output.
 * No database is required.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BatchOutputSchema } from "@preptrace/shared";
import { getConfig } from "../config/env";
import { runEvaluation } from "../evaluation/runEvaluation";
import { createServices } from "../services";

function fail(msg: string): never {
  process.stderr.write(`evaluate: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      concurrency: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  if (!values.input || !values.output) fail("usage: npm run evaluate -- --input <cases.json> --output <kits.json>");

  const inputPath = resolve(process.cwd(), values.input);
  const outputPath = resolve(process.cwd(), values.output);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (e) {
    fail(`could not read ${inputPath}: ${(e as Error).message}`);
  }
  const cases = Array.isArray(raw) ? raw : Array.isArray((raw as { cases?: unknown[] })?.cases) ? (raw as { cases: unknown[] }).cases : null;
  if (!cases) fail("input must be a JSON array of cases (or {\"cases\": [...]})");

  const cfg = getConfig();
  const services = createServices({ mode: "evaluation" });
  const log = (line: string) => process.stderr.write(`${line}\n`);
  if (!services.llm.available) log("WARNING: LLM_API_KEY is not set — every case will fail with LLM_NOT_CONFIGURED. See .env.example.");
  log(`Evaluating ${cases.length} case(s) · LLM ${services.llm.providerName}/${services.llm.model} · case concurrency ${values.concurrency ?? cfg.EVAL_CASE_CONCURRENCY}`);

  const started = Date.now();
  const output = await runEvaluation(cases, services, {
    caseConcurrency: Number(values.concurrency ?? cfg.EVAL_CASE_CONCURRENCY),
    caseTimeoutMs: cfg.EVAL_CASE_TIMEOUT_MS,
    log,
  });
  BatchOutputSchema.parse(output);

  mkdirSync(dirname(outputPath), { recursive: true });
  const tmp = `${outputPath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(output, null, 2));
  renameSync(tmp, outputPath);

  const ok = output.kits.filter((k) => k.status === "ok").length;
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${ok}/${output.kits.length} ok, ${output.kits.length - ok} failed · LLM calls ${services.llm.stats.calls} · wrote ${outputPath}`);
  await services.close();
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
