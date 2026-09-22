import { createHash } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Lowercase, strip punctuation, collapse whitespace. Used for fuzzy text comparison. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .replace(/[\s]+/g, " ")
    .trim();
}

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in is it its of on or that the this to was were will with you your we our they their i".split(" "),
);

export function tokens(s: string, dropStopwords = true): string[] {
  return normalizeText(s)
    .split(" ")
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((t) => t.length > 0 && (!dropStopwords || !STOPWORDS.has(t)));
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Deterministic grounding check: is `quote` actually supported by `source`?
 * True if the normalised quote is a substring, or ≥ `threshold` of its
 * content tokens appear in the source. This is how we stop the model from
 * inventing requirements, facts or hiring stages.
 */
export function quoteSupported(quote: string | undefined | null, source: string, threshold = 0.8): boolean {
  if (!quote) return false;
  const q = normalizeText(quote);
  if (q.length < 3) return false;
  const src = normalizeText(source);
  if (src.includes(q)) return true;
  const qt = tokens(quote);
  if (qt.length === 0) return false;
  const st = new Set(tokens(source));
  const hit = qt.filter((t) => st.has(t)).length;
  return hit / qt.length >= threshold;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return (lastBreak > max * 0.7 ? cut.slice(0, lastBreak + 1) : cut) + " …[truncated]";
}

// ---------------------------------------------------------------------------
// Prompt-injection defence (defence in depth; the primary defence is prompt
// structure: untrusted content is only ever placed in delimited user content).
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts|directions|rules)/i,
  /disregard (all |any )?(the )?(previous|prior|above|system) (instructions|prompts|rules)/i,
  /forget (all |your )?(previous |prior )?instructions/i,
  /you are now (a|an|in) /i,
  /(reveal|print|output|show) (your |the )?(system prompt|instructions|secrets?|api keys?)/i,
  /\bsystem prompt\b/i,
  /new instructions?:/i,
  /\bact as (a|an) /i,
  /(respond|reply|answer) only with/i,
  /<\/?(system|assistant|untrusted[_-]?content|instructions)\b/i,
];

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

/**
 * Remove sentences that look like instructions aimed at an AI, and neutralise
 * anything resembling our prompt delimiters so content cannot "close" its block.
 */
export function sanitizeUntrusted(text: string): { text: string; flagged: boolean } {
  let flagged = false;
  const lines = text.split("\n").map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => {
      if (INJECTION_PATTERNS.some((p) => p.test(s))) {
        flagged = true;
        return false;
      }
      return true;
    });
    return kept.join(" ");
  });
  const cleaned = lines
    .filter((l, i) => l.trim() !== "" || (i > 0 && lines[i - 1].trim() !== ""))
    .join("\n")
    .replace(/<\/?\s*(untrusted[_-]?content|system|assistant|instructions|user)[^>]*>/gi, "[removed-tag]");
  return { text: cleaned, flagged };
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}
