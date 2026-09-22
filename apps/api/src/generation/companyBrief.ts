import { z } from "zod";
import type { CompanyBrief } from "@preptrace/shared";
import type { Llm } from "../llm/client";
import { system, trusted, untrusted } from "../llm/prompt";
import type { ResearchBundle } from "../research/researchService";

const BriefOut = z.object({
  summary: z.string().min(1),
  what_they_do: z.string().min(1),
  fact_ids: z.array(z.string()).default([]),
});

export const LIMITED_INFO = "Limited public information was available.";

export async function generateCompanyBrief(llm: Llm, research: ResearchBundle, roleTitle: string): Promise<CompanyBrief> {
  const facts = research.signals.filter((s) => s.kind === "company");
  const publicSignals = research.signals.filter((s) => s.kind === "public").map((s) => ({ text: s.text, source_url: s.source_url }));
  const now = new Date().toISOString();
  const base = {
    hiring_process: research.hiring,
    public_signals: publicSignals,
    limitations: research.limitations,
    edited: false,
    version: 1,
    updatedAt: now,
  };

  if (facts.length === 0) {
    const desc = research.siteDescription.trim();
    return {
      ...base,
      summary: `${LIMITED_INFO} Almost nothing about ${research.companyName} could be verified from its website${
        research.robotsBlocked ? " (the site disallows automated access)" : ""
      }, so this kit is driven primarily by the job description.`,
      what_they_do: desc ? `The website describes the company as: "${desc.slice(0, 300)}"` : `Not enough verified information was found to describe what ${research.companyName} does.`,
      sources: desc ? [research.finalUrl] : [],
    };
  }

  const factList = facts.map((f) => `${f.id}: ${f.text}`).join("\n");
  const hiringLine = research.hiring.found ? `Official hiring process found: ${research.hiring.stages.map((s) => s.name).join(" → ")}` : "No official hiring process information was discovered.";
  const out = await llm.json({
    task: "company_brief",
    system: system(
      "You write concise, factual company briefs for a candidate preparing for an interview.",
      `Write a company brief using ONLY the numbered facts provided.
- summary: 2-4 sentences on the company and what matters for a candidate interviewing for the given role.
- what_they_do: 1-3 sentences describing the products/services and customers.
- fact_ids: the IDs of every fact you used.
- If the facts are thin, say explicitly that limited information was available. Never add facts from your own knowledge.`,
      `{"summary": string, "what_they_do": string, "fact_ids": ["S1"]}`,
    ),
    user: [
      trusted("role", `Company: ${research.companyName.replace(/[<>]/g, "")}\nRole: ${roleTitle.replace(/[<>]/g, "")}\n${hiringLine}`),
      untrusted("company_facts", factList, 8000),
    ].join("\n\n"),
    schema: BriefOut,
    maxTokens: 1200,
    temperature: 0.2,
  });

  const byId = new Map(facts.map((f) => [f.id, f]));
  const used = out.fact_ids.map((id) => byId.get(id.trim())).filter(Boolean);
  const sourceUrls = [...new Set((used.length ? used : facts.slice(0, 5)).map((f) => f!.source_url))];
  let summary = out.summary.trim();
  if (facts.length < 3 && !/limited/i.test(summary)) summary = `${summary} ${LIMITED_INFO}`;
  return { ...base, summary, what_they_do: out.what_they_do.trim(), sources: sourceUrls };
}
