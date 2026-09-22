"use client";

import Link from "next/link";
import { Quote, Target } from "lucide-react";
import type { RequirementKind, RequirementReadiness, WorkspaceRequirement } from "@preptrace/shared";
import { useKitCtx } from "@/components/kit/kit-context";
import { Badge, IdTag } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Meter, ProgressBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const KINDS: { kind: RequirementKind; label: string }[] = [
  { kind: "technical", label: "Technical" },
  { kind: "behavioural", label: "Behavioural" },
  { kind: "domain", label: "Domain" },
];

function RequirementCard({ r, rr, coverage, kitId }: { r: WorkspaceRequirement; rr?: RequirementReadiness; coverage: number; kitId: string }) {
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <IdTag>{r.id}</IdTag>
          <p className="text-[14px] font-medium leading-snug">{r.text}</p>
        </div>
        <Badge tone={r.priority === "must" ? "dark" : "outline"}>{r.priority === "must" ? "MUST" : "NICE"}</Badge>
      </div>
      <blockquote className="mt-3 flex gap-2 rounded-lg bg-subtle px-3 py-2 text-[12.5px] italic leading-relaxed text-muted">
        <Quote className="mt-0.5 h-3 w-3 shrink-0 not-italic text-faint" />
        {r.evidence}
      </blockquote>
      <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
        <div>
          <div className="text-muted">Coverage</div>
          <div className={cn("mt-0.5 font-medium", coverage === 0 && r.priority === "must" ? "text-bad" : "text-ink")}>
            {coverage} question{coverage === 1 ? "" : "s"}
          </div>
        </div>
        <div>
          <div className="text-muted">Confidence</div>
          <div className="mt-1">{rr?.avgConfidence != null ? <span className="font-medium tabular-nums">{rr.avgConfidence}/5</span> : <Meter value={null} />}</div>
        </div>
        <div>
          <div className="text-muted">Readiness</div>
          <div className="mt-1.5">
            <ProgressBar value={rr?.readiness ?? 0} tone="auto" size="sm" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[12px] text-muted">{rr?.itemsPracticed ?? 0}/{rr?.itemsTotal ?? 0} items practised</span>
        <Link href={`/kits/${kitId}/weak-spots?repair=${r.id}`} className={buttonClass("secondary", "sm")}>
          <Target className="h-3.5 w-3.5" /> Practice
        </Link>
      </div>
    </div>
  );
}

export default function RolePage() {
  const { kit, readiness } = useKitCtx();
  const coverage = (id: string) => kit.questions.filter((q) => !q.meta.deleted && q.requirement_ids.includes(id)).length;
  const rrById = new Map(readiness?.requirements.map((r) => [r.requirementId, r]));

  return (
    <div className="space-y-8">
      <Card className="grid gap-5 p-5 sm:grid-cols-3">
        <div>
          <SectionLabel>Title</SectionLabel>
          <div className="mt-1 text-[14.5px] font-medium">{kit.role.title}</div>
        </div>
        <div>
          <SectionLabel>Seniority</SectionLabel>
          <div className="mt-1 text-[14.5px] font-medium capitalize">{kit.role.seniority}</div>
        </div>
        <div>
          <SectionLabel>Location</SectionLabel>
          <div className="mt-1 text-[14.5px] font-medium">{kit.role.location}</div>
        </div>
        {kit.role.responsibilities.length > 0 && (
          <div className="sm:col-span-3">
            <SectionLabel>Responsibilities</SectionLabel>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {kit.role.responsibilities.map((r) => (
                <li key={r} className="flex gap-2 text-[13.5px] text-ink-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" /> {r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {(["must", "nice"] as const).map((p) => {
        const reqs = kit.role.requirements.filter((r) => r.priority === p);
        if (reqs.length === 0) return null;
        return (
          <section key={p}>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.015em]">
              {p === "must" ? "Must have" : "Nice to have"} <Badge>{reqs.length}</Badge>
            </h2>
            <div className="mt-4 space-y-6">
              {KINDS.map(({ kind, label }) => {
                const group = reqs.filter((r) => r.kind === kind);
                if (!group.length) return null;
                return (
                  <div key={kind}>
                    <SectionLabel className="mb-2.5">{label}</SectionLabel>
                    <div className="grid gap-3 md:grid-cols-2">
                      {group.map((r) => (
                        <RequirementCard key={r.id} r={r} rr={rrById.get(r.id)} coverage={coverage(r.id)} kitId={kit.id} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="text-[12.5px] text-muted">Every requirement above is quoted from your job description. Requirements the AI proposed without support in the text were discarded.</p>
    </div>
  );
}
