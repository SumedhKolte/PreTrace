"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, ExternalLink, FileText, Gauge, Globe, Layers, ListChecks, Target, Users } from "lucide-react";
import { itemState, type PracticeItemStats, type WorkspaceQuestion } from "@preptrace/shared";
import { Badge, IdTag } from "@/components/ui/badge";
import { Modal } from "@/components/ui/overlay";
import { Meter } from "@/components/ui/progress";
import { pathOf } from "@/lib/utils";
import { useKitCtx } from "./kit-context";
import { CATEGORY_META, DIFFICULTY_LABEL, STATE_LABEL } from "./labels";

function Step({ icon, label, children, last }: { icon: ReactNode; label: string; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-0">
      {!last && <span className="absolute left-[15px] top-9 h-[calc(100%-28px)] w-px bg-line" aria-hidden />}
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-2 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</div>
        <div className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{children}</div>
      </div>
    </li>
  );
}

function SignalList({ items, empty }: { items: WorkspaceQuestion["evidence"]["signals"]; empty: string }) {
  if (!items.length) return <span className="text-muted">{empty}</span>;
  return (
    <ul className="space-y-2">
      {items.map((s, i) => (
        <li key={i}>
          <div>{s.text}</div>
          <a href={s.source_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11.5px] text-accent-700 hover:underline">
            {pathOf(s.source_url)} <ExternalLink className="h-3 w-3" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Why am I seeing this question?" — the pipeline made visible:
 * JD → requirement → research → question → practice → weak spot.
 * Only grounded data is shown; no prompts or internals.
 */
export function EvidencePanel({ question, open, onOpenChange, stats }: { question: WorkspaceQuestion | null; open: boolean; onOpenChange: (o: boolean) => void; stats?: PracticeItemStats }) {
  const { kit, readiness } = useKitCtx();
  if (!question) return null;
  const reqs = kit.role.requirements.filter((r) => question.requirement_ids.includes(r.id));
  const company = question.evidence.signals.filter((s) => s.kind === "company");
  const hiring = question.evidence.signals.filter((s) => s.kind === "hiring");
  const pub = question.evidence.signals.filter((s) => s.kind === "public");
  const cat = CATEGORY_META[question.category];
  const weak = readiness?.weakSpots.filter((w) => question.requirement_ids.includes(w.requirementId)) ?? [];
  const state = itemState(question.meta);

  return (
    <Modal open={open} onOpenChange={onOpenChange} side title="Why this question?" description={<span className="line-clamp-2">{question.prompt}</span>}>
      <ol>
        <Step icon={<ListChecks />} label="Requirement">
          <ul className="space-y-1.5">
            {reqs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <IdTag>{r.id}</IdTag>
                <span className="font-medium text-ink">{r.text}</span>
                <Badge tone={r.priority === "must" ? "dark" : "outline"}>{r.priority === "must" ? "MUST" : "NICE"}</Badge>
              </li>
            ))}
          </ul>
        </Step>
        <Step icon={<FileText />} label="JD signal">
          {question.evidence.jd_signal ? <blockquote className="border-l-2 border-accent-300 pl-3 italic text-ink">&ldquo;{question.evidence.jd_signal}&rdquo;</blockquote> : <span className="text-muted">Added manually.</span>}
        </Step>
        <Step icon={<Building2 />} label="Company signal">
          <SignalList items={company} empty="No company-specific research was used for this question." />
        </Step>
        <Step icon={<Users />} label="Hiring signal (official)">
          <SignalList items={hiring} empty={kit.companyBrief.hiring_process.found ? "Not linked to a specific interview stage." : "No official hiring process information was discovered."} />
        </Step>
        {pub.length > 0 && (
          <Step icon={<Globe />} label="Public discussion (unverified)">
            <SignalList items={pub} empty="" />
          </Step>
        )}
        <Step icon={<Layers />} label="Generated category">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] font-medium ${cat.soft}`}>
              <cat.icon className="h-3.5 w-3.5" /> {cat.label}
            </span>
            <span>
              Difficulty {question.difficulty} / 3 · {DIFFICULTY_LABEL[question.difficulty]}
            </span>
            <Badge tone="outline">{STATE_LABEL[state]}</Badge>
          </div>
          {question.evidence.rationale && <p className="mt-2 text-muted">{question.evidence.rationale}</p>}
          {question.meta.producer === "gap_fill" && <p className="mt-1 text-[12.5px] text-accent-700">Added by the coverage check to cover a must-have requirement.</p>}
          {question.meta.producer === "fallback_template" && <p className="mt-1 text-[12.5px] text-warn">Template question added deterministically after AI gap-filling did not cover this requirement.</p>}
        </Step>
        <Step icon={<Target />} label="Practice">
          {stats?.attempts ? (
            <div className="flex items-center gap-3">
              <Meter value={stats.lastConfidence} />
              <span>
                Last confidence {stats.lastConfidence}/5 · {stats.attempts} attempt{stats.attempts === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            <span className="text-muted">Not practised yet.</span>
          )}
        </Step>
        <Step icon={<Gauge />} label="Weak spot" last>
          {weak.length ? (
            <div className="space-y-1">
              {weak.map((w) => (
                <div key={w.requirementId}>
                  <span className="font-medium text-bad">{w.topic}</span> is a weak spot · readiness {w.readiness}%.{" "}
                  <Link href={`/kits/${kit.id}/weak-spots?repair=${w.requirementId}`} className="font-medium text-accent-700 hover:underline">
                    Fix this weakness
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-muted">Not currently a weak spot.</span>
          )}
        </Step>
      </ol>
    </Modal>
  );
}
