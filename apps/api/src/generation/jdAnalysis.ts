import { z } from "zod";
import type { Priority, WorkspaceRequirement } from "@preptrace/shared";
import type { Llm } from "../llm/client";
import { system, untrusted } from "../llm/prompt";
import { jaccard, normalizeText, quoteSupported, sanitizeUntrusted } from "../lib/text";

const JdOutput = z.object({
  company: z.string().nullish(),
  role_title: z.string().nullish(),
  seniority: z.string().nullish(),
  location: z.string().nullish(),
  responsibilities: z.array(z.string()).default([]),
  requirements: z
    .array(
      z.object({
        text: z.string().min(2),
        topic: z.string().nullish(),
        kind: z.string(),
        priority: z.string(),
        evidence_quote: z.string().nullish(),
      }),
    )
    .default([]),
});

const SCHEMA = `{
  "company": string | null,            // company name only if stated in the JD
  "role_title": string | null,
  "seniority": "intern" | "junior" | "mid" | "senior" | "staff" | "principal" | "lead" | "manager" | "unspecified",
  "location": string | null,           // only if stated (e.g. "Remote (EU)", "Berlin")
  "responsibilities": string[],        // concise, max 10, taken from the JD
  "requirements": [{
    "text": string,                    // one skill/experience/trait, concise, faithful to the JD
    "topic": string,                   // 1-3 word label, e.g. "PostgreSQL", "Mentoring"
    "kind": "technical" | "behavioural" | "domain",
    "priority": "must" | "nice",
    "evidence_quote": string           // exact phrase copied from the JD that states this requirement
  }]
}`;

const TASK = `Extract the role profile from the job description.
Only extract requirements supported by the provided job description. Be conservative:
- Each requirement must be explicitly stated in the JD; copy the supporting phrase verbatim into evidence_quote.
- Do not infer technologies, skills or traits that are not written in the JD. A thin JD must produce a thin requirement list.
- Split compound lines into separate requirements only when they are clearly distinct skills (e.g. "React and Node.js" → two).
- kind: "technical" = languages, frameworks, tools, engineering practices; "behavioural" = communication, leadership, mentoring, collaboration, ownership; "domain" = industry/business knowledge (e.g. payments, healthcare, compliance).
- priority: "must" for required/minimum qualifications and core responsibilities' skills; "nice" for items described as nice-to-have, bonus, preferred, a plus.
- Do not include benefits, salary, perks or company boilerplate as requirements.`;

export interface JdAnalysis {
  company: string | null;
  title: string;
  seniority: string;
  location: string;
  responsibilities: string[];
  requirements: WorkspaceRequirement[];
  dropped: string[];
  thin: boolean;
}

const SENIORITIES = ["intern", "junior", "mid", "senior", "staff", "principal", "lead", "manager"];

export function inferSeniority(title: string, jd: string): string {
  const t = `${title}`.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return "intern";
  if (/\b(principal|distinguished)\b/.test(t)) return "principal";
  if (/\bstaff\b/.test(t)) return "staff";
  if (/\b(head|director|manager|vp)\b/.test(t)) return "manager";
  if (/\b(lead|tech lead)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|graduate|entry)\b/.test(t)) return "junior";
  const years = /(\d+)\+?\s*(?:years|yrs)/i.exec(jd);
  if (years) {
    const y = Number(years[1]);
    if (y >= 7) return "senior";
    if (y >= 5) return "senior";
    if (y >= 2) return "mid";
    return "junior";
  }
  return "unspecified";
}

// ---------------------------------------------------------------------------
// Deterministic must/nice detection from JD structure.
// ---------------------------------------------------------------------------

const NICE_HEADER = /(nice[- ]to[- ]have|bonus|preferred|a plus|good to have|desirable|optional|extra credit|would be great|pluses)/i;
const MUST_HEADER = /(requirement|must[- ]have|qualification|you have|you bring|you.?ll need|what we.?re looking for|what you need|skills|experience|minimum|basic|about you)/i;
/** Headers written without a colon must match this vocabulary exactly (avoids treating short bullet-less lines as headers). */
const HEADER_VOCAB =
  /^(requirements|qualifications|must[- ]haves?|nice[- ]to[- ]haves?|bonus( points)?|preferred( qualifications| skills)?|what you.?ll need|what we.?re looking for|who you are|you have|about you|skills|responsibilities|what you.?ll do|minimum qualifications|basic qualifications|good to have|benefits|perks|about us|the role)$/i;
const INLINE_NICE = /(nice[- ]to[- ]have|is a plus|a plus\b|bonus|preferred|ideally|desirable|good to have|familiarity .* helpful)/i;
const INLINE_MUST = /\b(must|required|mandatory|essential)\b/i;

interface JdLine {
  text: string;
  section: "must" | "nice" | null;
}

export function jdLines(jd: string): JdLine[] {
  const out: JdLine[] = [];
  let section: JdLine["section"] = null;
  for (const raw of jd.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bare = line.replace(/^[#*\-•\s]+/, "").replace(/[*_]+/g, "").trim();
    const explicitHeader = /:$/.test(bare) || /^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line);
    const vocabHeader = !/^[-*•]/.test(line) && HEADER_VOCAB.test(bare);
    if ((explicitHeader || vocabHeader) && bare.length < 80) {
      if (NICE_HEADER.test(bare)) section = "nice";
      else if (MUST_HEADER.test(bare)) section = "must";
      else section = null;
    }
    out.push({ text: line, section });
  }
  return out;
}

export function detectPriority(quote: string, lines: JdLine[], llmPriority: Priority): Priority {
  let best: JdLine | null = null;
  let bestScore = 0;
  for (const l of lines) {
    const s = normalizeText(l.text).includes(normalizeText(quote)) ? 1 : jaccard(l.text, quote);
    if (s > bestScore) [best, bestScore] = [l, s];
  }
  if (!best || bestScore < 0.3) return llmPriority;
  if (INLINE_NICE.test(best.text)) return "nice";
  if (INLINE_MUST.test(best.text)) return "must";
  return best.section ?? llmPriority;
}

function toKind(k: string): WorkspaceRequirement["kind"] {
  const v = k.toLowerCase();
  if (v.startsWith("behav")) return "behavioural";
  if (v.startsWith("domain")) return "domain";
  return "technical";
}

function deriveTopic(text: string): string {
  const words = text.replace(/^(experience|proficiency|knowledge|strong|solid|with|in|of|using|and)\s+/gi, "").split(/\s+/);
  return words.slice(0, 3).join(" ").replace(/[.,;:]$/, "");
}

export async function analyzeJobDescription(llm: Llm, jd: string): Promise<JdAnalysis> {
  const out = await llm.json({
    task: "jd_analysis",
    system: system("You are a meticulous technical recruiter analysing a job description.", TASK, SCHEMA),
    user: untrusted("job_description", jd, 24_000),
    schema: JdOutput,
    maxTokens: 4096,
    temperature: 0.1,
  });
  return postProcessJd(jd, out);
}

/** Deterministic grounding, priority correction, dedupe and ID assignment. Exported for tests. */
export function postProcessJd(jd: string, out: z.infer<typeof JdOutput>): JdAnalysis {
  const lines = jdLines(jd);
  const dropped: string[] = [];
  const kept: Omit<WorkspaceRequirement, "id">[] = [];

  for (const r of out.requirements) {
    const text = sanitizeUntrusted(r.text).text.trim();
    if (!text) continue;
    const quote = r.evidence_quote?.trim() || "";
    const grounded = quoteSupported(quote, jd, 0.8) || quoteSupported(text, jd, 0.75);
    if (!grounded) {
      dropped.push(text);
      continue;
    }
    const llmPriority: Priority = r.priority.toLowerCase().startsWith("nice") ? "nice" : "must";
    const priority = detectPriority(quote || text, lines, llmPriority);
    const dup = kept.find((k) => jaccard(k.text, text) >= 0.75);
    if (dup) {
      if (priority === "must") dup.priority = "must";
      continue;
    }
    kept.push({
      text,
      kind: toKind(r.kind),
      priority,
      topic: (r.topic?.trim() || deriveTopic(text)).slice(0, 40),
      evidence: quoteSupported(quote, jd, 0.8) ? quote : text,
    });
  }

  const title = (out.role_title?.trim() || firstLineTitle(jd) || "Role not specified").slice(0, 120);
  let requirements: WorkspaceRequirement[] = kept.slice(0, 30).map((r, i) => ({ id: `r${i + 1}`, ...r }));
  let thin = requirements.length < 3;

  // A kit needs at least one requirement to anchor questions. If the JD states none,
  // we anchor on the role itself (which the JD does state) rather than inventing skills.
  if (requirements.length === 0) {
    thin = true;
    requirements = [
      {
        id: "r1",
        text: `Core competencies for the ${title} role (the job description lists no explicit requirements)`,
        kind: "technical",
        priority: "must",
        topic: title.split(/\s+/).slice(0, 3).join(" "),
        evidence: title,
      },
    ];
  }

  const company = out.company && normalizeText(jd).includes(normalizeText(out.company)) ? out.company.trim() : null;
  const location = out.location && quoteSupported(out.location, jd, 0.6) ? out.location.trim() : "Not specified";
  let seniority = (out.seniority ?? "").toLowerCase().trim();
  if (!SENIORITIES.includes(seniority)) seniority = inferSeniority(title, jd);

  const responsibilities = out.responsibilities
    .map((r) => sanitizeUntrusted(r).text.trim())
    .filter((r) => r && quoteSupported(r, jd, 0.6))
    .slice(0, 10);

  return { company, title, seniority, location, responsibilities, requirements, dropped, thin };
}

function firstLineTitle(jd: string): string | null {
  const first = jd.split(/\r?\n/).map((l) => l.replace(/^[#*\s]+/, "").trim()).find(Boolean);
  if (!first || first.length > 80) return null;
  return first.replace(/[.:]$/, "");
}
