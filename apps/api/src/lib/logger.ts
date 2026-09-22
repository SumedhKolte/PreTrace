/* Minimal structured logger. Keeps output readable in dev and JSON-ish in prod. */

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold: Level =
  (process.env.LOG_LEVEL as Level) || (process.env.NODE_ENV === "test" ? "error" : "info");

const SECRET_KEYS = /(key|secret|password|token|authorization|cookie)/i;

function redact(meta: Record<string, unknown> | undefined) {
  if (!meta) return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : v;
  return out;
}

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (order[level] < order[threshold]) return;
  const line = { t: new Date().toISOString(), level, msg, ...redact(meta) };
  const text = process.env.NODE_ENV === "production" ? JSON.stringify(line) : `[${level}] ${msg}${meta ? " " + JSON.stringify(redact(meta)) : ""}`;
  (level === "error" || level === "warn" ? console.error : console.log)(text);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => log("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => log("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log("error", m, meta),
};
