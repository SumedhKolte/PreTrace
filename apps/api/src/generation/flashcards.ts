import { z } from "zod";
import type { WorkspaceRequirement } from "@preptrace/shared";
import type { Llm } from "../llm/client";
import { system, trusted, untrusted } from "../llm/prompt";
import { jaccard, sanitizeUntrusted } from "../lib/text";

export interface GeneratedFlashcard {
  front: string;
  back: string;
  requirement_ids: string[];
  producer: "llm" | "fallback_template";
}

const CardsOut = z.object({
  flashcards: z
    .array(z.object({ front: z.string().min(3), back: z.string().min(3), requirement_ids: z.array(z.string()).default([]) }))
    .default([]),
});

export function flashcardTarget(reqCount: number) {
  return Math.max(8, Math.min(20, Math.round(reqCount * 1.2)));
}

export async function generateFlashcards(
  llm: Llm,
  args: {
    roleTitle: string;
    requirements: WorkspaceRequirement[];
    questions: { id: string; prompt: string; requirement_ids: string[] }[];
    count?: number;
    avoid?: string[];
  },
): Promise<GeneratedFlashcard[]> {
  const count = args.count ?? flashcardTarget(args.requirements.length);
  const out = await llm.json({
    task: "flashcards",
    system: system(
      "You create concise study flashcards for interview preparation.",
      `Create ${count} flashcards that help the candidate recall the concepts behind the requirements and questions.
- front: a short question or concept prompt (max ~20 words). back: a precise answer in 2-5 short lines.
- Cover every MUST requirement with at least one card. Each card's requirement_ids must come from the requirement list.
- Focus on durable knowledge (concepts, trade-offs, definitions, frameworks like STAR) — not company trivia.
- Do not duplicate the existing cards.`,
      `{"flashcards": [{"front": string, "back": string, "requirement_ids": ["r1"]}]}`,
    ),
    user: [
      trusted("role", `Role: ${args.roleTitle.replace(/[<>]/g, "")}`),
      trusted(
        "requirements",
        args.requirements.map((r) => `${r.id} [${r.priority.toUpperCase()}, ${r.kind}] ${sanitizeUntrusted(r.text).text}`).join("\n"),
      ),
      untrusted("questions", args.questions.slice(0, 30).map((q) => `- (${q.requirement_ids.join(",")}) ${q.prompt}`).join("\n"), 6000),
      args.avoid?.length ? untrusted("existing_cards", args.avoid.map((a) => `- ${a}`).join("\n"), 3000) : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: CardsOut,
    maxTokens: 5000,
    temperature: 0.4,
  });
  return postProcessFlashcards(out.flashcards, args.requirements, args.avoid ?? []).slice(0, count + 4);
}

export function postProcessFlashcards(
  raw: { front: string; back: string; requirement_ids: string[] }[],
  requirements: WorkspaceRequirement[],
  avoid: string[],
): GeneratedFlashcard[] {
  const valid = new Set(requirements.map((r) => r.id));
  const seen = [...avoid];
  const out: GeneratedFlashcard[] = [];
  for (const c of raw) {
    const ids = [...new Set(c.requirement_ids.map((s) => s.trim()))].filter((id) => valid.has(id));
    if (ids.length === 0) continue;
    const front = sanitizeUntrusted(c.front).text.trim();
    const back = sanitizeUntrusted(c.back).text.trim();
    if (!front || !back || seen.some((s) => jaccard(s, front) >= 0.7)) continue;
    seen.push(front);
    out.push({ front, back, requirement_ids: ids, producer: "llm" });
  }
  return out;
}

/** Deterministic backstop: a MUST requirement with no card gets one derived from its covering question. */
export function fallbackFlashcards(
  requirements: WorkspaceRequirement[],
  cards: { requirement_ids: string[] }[],
  questions: { prompt: string; answer_outline: string; requirement_ids: string[] }[],
): GeneratedFlashcard[] {
  const covered = new Set(cards.flatMap((c) => c.requirement_ids));
  const out: GeneratedFlashcard[] = [];
  for (const r of requirements) {
    if (r.priority !== "must" || covered.has(r.id)) continue;
    const q = questions.find((x) => x.requirement_ids.includes(r.id));
    if (!q) continue;
    out.push({ front: `Key points to cover: ${r.topic}`, back: q.answer_outline, requirement_ids: [r.id], producer: "fallback_template" });
  }
  return out;
}
