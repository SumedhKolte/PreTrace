"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Cpu, Gauge, Globe2, ListChecks, Route, Target, UserSearch } from "lucide-react";
import { useKitCtx } from "@/components/kit/kit-context";
import { CATEGORY_META } from "@/components/kit/labels";
import { Badge, IdTag } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, SectionLabel } from "@/components/ui/card";
import { ProgressBar, ReadinessRing } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/states";
import { minutesLabel } from "@/lib/utils";

export default function KitOverviewPage() {
  const { kit, readiness } = useKitCtx();
  const base = `/kits/${kit.id}`;
  const must = kit.role.requirements.filter((r) => r.priority === "must");
  const nice = kit.role.requirements.filter((r) => r.priority === "nice");
  const covered = must.length - kit.coverage.uncovered_requirement_ids.length;
  const okSources = kit.research.sources.filter((s) => s.status === "ok");
  const hp = kit.companyBrief.hiring_process;
  const totalMinutes = kit.schedule.days.reduce((s, d) => s + d.minutes, 0);
  const questionCount = kit.questions.filter((q) => !q.meta.deleted).length;

  return (
    <div className="space-y-5">
      {kit.generation.warnings.length > 0 && kit.status === "partial" && (
        <div className="flex gap-3 rounded-xl border border-[#fbe3b8] bg-warn-soft px-4 py-3 text-[13.5px] text-ink-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div>
            <span className="font-medium text-warn">This kit is partial.</span> {kit.generation.warnings.slice(0, 2).join(" ")}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Readiness */}
        <Card className="lg:col-span-1">
          <CardHeader title="Interview readiness" icon={<Gauge className="h-4 w-4" />} action={<Link href={`${base}/weak-spots`} className="text-[12.5px] font-medium text-accent-700 hover:underline">Details</Link>} />
          <CardBody>
            {readiness ? (
              <div className="flex items-center gap-5">
                <ReadinessRing value={readiness.overall} size={96} stroke={8} />
                <div className="min-w-0 flex-1 space-y-2">
                  {readiness.categories.map((c) => (
                    <div key={c.category}>
                      <div className="mb-0.5 flex justify-between text-[12px]">
                        <span className="text-ink-2">{CATEGORY_META[c.category].label}</span>
                        <span className="tabular-nums text-muted">{c.readiness}%</span>
                      </div>
                      <ProgressBar value={c.readiness} tone="auto" size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Skeleton className="h-24" />
            )}
          </CardBody>
        </Card>

        {/* Coverage */}
        <Card>
          <CardHeader title="Requirement coverage" icon={<ListChecks className="h-4 w-4" />} description="Deterministic check: every must-have has a question." />
          <CardBody>
            <div className="flex items-baseline gap-2">
              <span className="text-[30px] font-semibold tabular-nums tracking-[-0.03em]">
                {covered}/{must.length}
              </span>
              <span className="text-[13px] text-muted">must-haves covered</span>
            </div>
            <ProgressBar value={must.length ? (covered / must.length) * 100 : 100} tone={covered === must.length ? "good" : "bad"} className="mt-3" />
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                ["Passes", kit.coverage.passes],
                ["Questions", questionCount],
                ["Nice-to-have", nice.length],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-subtle py-2">
                  <div className="text-[16px] font-semibold tabular-nums">{v}</div>
                  <div className="text-[11.5px] text-muted">{l}</div>
                </div>
              ))}
            </div>
            {kit.coverage.log.length > 1 && (
              <div className="mt-3 text-[12px] text-muted">
                {kit.coverage.log.slice(0, 1).map((l, i) => (
                  <div key={i}>Pass {l.pass}: {l.uncovered.length ? `found ${l.uncovered.length} gap(s) (${l.uncovered.join(", ")}) → ${l.action}` : l.action}</div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Research */}
        <Card>
          <CardHeader title="Research" icon={<Globe2 className="h-4 w-4" />} action={<Link href={`${base}/company`} className="text-[12.5px] font-medium text-accent-700 hover:underline">Sources</Link>} />
          <CardBody className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[30px] font-semibold tabular-nums tracking-[-0.03em]">{okSources.length}</span>
              <span className="text-[13px] text-muted">research sources used</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={hp.found ? "good" : "neutral"} icon={hp.found ? <CheckCircle2 className="h-3 w-3" /> : undefined}>
                {hp.found ? `Hiring process · ${hp.stages.length} stages` : "No official hiring process"}
              </Badge>
              <Badge>{kit.source.pages_used.length} company pages</Badge>
              {kit.companyBrief.public_signals.length > 0 && <Badge tone="warn">{kit.companyBrief.public_signals.length} public signals</Badge>}
            </div>
            {kit.research.limitations.slice(0, 2).map((l) => (
              <p key={l} className="text-[12.5px] leading-relaxed text-muted">
                {l}
              </p>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Company brief */}
        <Card className="lg:col-span-3">
          <CardHeader title="Company brief" icon={<Building2 className="h-4 w-4" />} action={<Link href={`${base}/company`} className={buttonClass("ghost", "sm")}>Open <ArrowRight className="h-3.5 w-3.5" /></Link>} />
          <CardBody className="space-y-4">
            <p className="text-[14.5px] leading-relaxed text-ink">{kit.companyBrief.summary}</p>
            <div>
              <SectionLabel>What they do</SectionLabel>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{kit.companyBrief.what_they_do}</p>
            </div>
          </CardBody>
        </Card>

        {/* Interview process */}
        <Card className="lg:col-span-2">
          <CardHeader title="Interview process" icon={<Route className="h-4 w-4" />} description={hp.found ? "From the company's own hiring page" : undefined} />
          <CardBody>
            {hp.found ? (
              <ol className="space-y-3">
                {hp.stages.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-night font-mono text-[11px] text-white">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium">{s.name}</div>
                      {s.description && <div className="text-[12.5px] leading-relaxed text-muted">{s.description}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-muted">No official hiring process information was discovered. Questions focus on the job description instead of guessing interview rounds.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Role snapshot */}
        <Card className="lg:col-span-3">
          <CardHeader title="Role snapshot" icon={<UserSearch className="h-4 w-4" />} action={<Link href={`${base}/role`} className={buttonClass("ghost", "sm")}>Breakdown <ArrowRight className="h-3.5 w-3.5" /></Link>} />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {must.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px]">
                  <IdTag>{r.id}</IdTag> {r.topic}
                </span>
              ))}
              {nice.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-2 py-1 text-[12.5px] text-muted">
                  <IdTag>{r.id}</IdTag> {r.topic}
                </span>
              ))}
            </div>
            {kit.role.responsibilities.length > 0 && (
              <div>
                <SectionLabel>Responsibilities</SectionLabel>
                <ul className="mt-2 space-y-1.5">
                  {kit.role.responsibilities.slice(0, 4).map((r) => (
                    <li key={r} className="flex gap-2 text-[13.5px] text-ink-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Weak spots + plan */}
        <Card className="lg:col-span-2">
          <CardHeader title="Top weak spots" icon={<Target className="h-4 w-4" />} action={<Link href={`${base}/weak-spots`} className={buttonClass("ghost", "sm")}>Coach <ArrowRight className="h-3.5 w-3.5" /></Link>} />
          <CardBody className="space-y-3">
            {readiness ? (
              readiness.weakSpots.slice(0, 3).map((w) => (
                <div key={w.requirementId}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span className="truncate font-medium">{w.topic}</span>
                    <span className="tabular-nums text-muted">{w.readiness}%</span>
                  </div>
                  <ProgressBar value={w.readiness} tone="auto" size="sm" />
                </div>
              ))
            ) : (
              <Skeleton className="h-20" />
            )}
            {readiness && readiness.weakSpots.length === 0 && <p className="text-[13px] text-muted">You&apos;re looking strong. Practise a few more questions to uncover areas worth reviewing.</p>}
            <div className="flex items-center justify-between border-t border-line pt-3 text-[12.5px] text-muted">
              <span>
                {kit.schedule.days.length}-day plan · {minutesLabel(totalMinutes)}
              </span>
              <Link href={`${base}/schedule`} className="font-medium text-accent-700 hover:underline">
                Schedule
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Generation metadata */}
      <Card>
        <CardHeader title="Generation details" icon={<Cpu className="h-4 w-4" />} description="How this kit was produced." />
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 text-[13px] sm:grid-cols-4">
            {[
              ["Model", `${kit.generation.provider ?? "—"} / ${kit.generation.model ?? "—"}`],
              ["Duration", kit.generation.durationMs ? `${(kit.generation.durationMs / 1000).toFixed(1)}s` : "—"],
              ["LLM calls", kit.generation.llmCalls ?? "—"],
              ["Coverage passes", kit.coverage.passes],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-muted">{k}</dt>
                <dd className="mt-0.5 truncate font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {kit.generation.systemDesignJustification && <p className="mt-4 text-[12.5px] text-muted">System design: {kit.generation.systemDesignJustification}</p>}
          {kit.generation.warnings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {kit.generation.warnings.map((w) => (
                <li key={w} className="flex gap-2 text-[12.5px] text-muted">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" /> {w}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
