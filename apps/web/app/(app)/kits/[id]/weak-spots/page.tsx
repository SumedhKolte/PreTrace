"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, BookOpen, ChevronDown, Info, ListChecks, Play, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import type { RequirementReadiness } from "@preptrace/shared";
import { useKitCtx } from "@/components/kit/kit-context";
import { CATEGORY_META, REASON_LABEL } from "@/components/kit/labels";
import { RepairSession } from "@/components/kit/repair-session";
import { Badge, IdTag } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, SectionLabel } from "@/components/ui/card";
import { ProgressBar, ReadinessRing } from "@/components/ui/progress";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { useRecommended } from "@/lib/hooks";
import { cn } from "@/lib/utils";

function severity(w: RequirementReadiness) {
  if (w.weakness >= 60) return { dot: "bg-bad", ring: "ring-bad/15", label: "High" };
  if (w.weakness >= 35) return { dot: "bg-[#e0a023]", ring: "ring-[#e0a023]/15", label: "Medium" };
  return { dot: "bg-good", ring: "ring-good/15", label: "Low" };
}

function WeakSpotCard({ w, onFix, rank }: { w: RequirementReadiness; onFix: () => void; rank: number }) {
  const s = severity(w);
  return (
    <div className="card animate-rise p-5" style={{ animationDelay: `${rank * 60}ms` }}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4", s.dot, s.ring)} aria-label={`${s.label} severity`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[16px] font-semibold tracking-[-0.015em]">{w.topic}</h3>
            <IdTag>{w.requirementId}</IdTag>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{w.text}</p>
        </div>
        <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{w.readiness}%</span>
      </div>
      <ProgressBar value={w.readiness} tone="auto" className="mt-4" label={`${w.topic} readiness`} />
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
        <div>
          <dt className="text-muted">Confidence</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{w.avgConfidence !== null ? `${w.avgConfidence}/5` : "Not rated"}</dd>
        </div>
        <div>
          <dt className="text-muted">Priority</dt>
          <dd className="mt-0.5 font-medium capitalize">{w.priority}</dd>
        </div>
        <div>
          <dt className="text-muted">Difficulty</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{w.avgDifficulty}/3</dd>
        </div>
        <div>
          <dt className="text-muted">Practised</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {w.itemsPracticed}/{w.itemsTotal}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[12px] text-muted">Why:</span>
          {w.reasons.map((r) => (
            <Badge key={r} tone={r === "must_have" ? "dark" : r === "low_confidence" || r === "uncovered" ? "bad" : "neutral"}>
              {REASON_LABEL[r]}
            </Badge>
          ))}
        </div>
        <Button variant="dark" size="sm" icon={<Wrench className="h-3.5 w-3.5" />} onClick={onFix} disabled={w.itemsTotal === 0}>
          Fix this weakness
        </Button>
      </div>
    </div>
  );
}

export default function WeakSpotsPage() {
  const { kit, readiness } = useKitCtx();
  const rec = useRecommended(kit.id, 15);
  const [repair, setRepair] = useState<string | null>(useSearchParams().get("repair"));
  const [formulaOpen, setFormulaOpen] = useState(false);

  if (!readiness) return <PageSkeleton />;
  const nothingPractised = readiness.practicedItems === 0;
  const verdict =
    readiness.overall >= 75 ? "You're in strong shape. Keep your weak spots warm." : readiness.overall >= 45 ? "Solid progress — a few targeted sessions will close the gaps." : nothingPractised ? "Not practised yet. These are your highest-stakes areas — start here." : "Early days. Focus on your must-have weak spots first.";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-night-line bg-night p-6 text-white sm:p-8">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="relative grid gap-8 md:grid-cols-[auto_1fr] md:items-center">
          <div className="flex items-center gap-5">
            <ReadinessRing value={readiness.overall} size={132} stroke={10} dark label="Overall readiness" />
            <div className="md:hidden">
              <div className="text-[12px] uppercase tracking-[0.08em] text-white/50">Your interview readiness</div>
            </div>
          </div>
          <div>
            <div className="hidden text-[12px] font-medium uppercase tracking-[0.08em] text-white/50 md:block">Your Interview Readiness</div>
            <p className="mt-1 text-balance text-[18px] font-medium leading-snug tracking-[-0.015em]">{verdict}</p>
            <div className="mt-5 space-y-2.5">
              {readiness.categories.map((c) => (
                <div key={c.category} className="grid grid-cols-[110px_1fr_44px] items-center gap-3 text-[13px]">
                  <span className="text-white/70">{CATEGORY_META[c.category].label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div className={cn("h-full rounded-full transition-[width] duration-700", c.readiness >= 70 ? "bg-[#4ade80]" : c.readiness >= 40 ? "bg-[#fbbf24]" : "bg-[#f87171]")} style={{ width: `${Math.max(2, c.readiness)}%` }} />
                  </div>
                  <span className="text-right tabular-nums text-white/80">{c.readiness}%</span>
                </div>
              ))}
            </div>
            <div className="mt-5 text-[12.5px] text-white/50">
              {readiness.practicedItems} of {readiness.totalItems} items practised
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.015em]">
            Top weak spots {readiness.weakSpots.length > 0 && <Badge tone="bad">{readiness.weakSpots.length}</Badge>}
          </h2>
          {readiness.weakSpots.length === 0 ? (
            <EmptyState icon={<ShieldCheck />} title="You're looking strong." description="Practise a few more questions to uncover areas worth reviewing." />
          ) : (
            readiness.weakSpots.map((w, i) => <WeakSpotCard key={w.requirementId} w={w} rank={i} onFix={() => setRepair(w.requirementId)} />)
          )}
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Recommended next session" icon={<Sparkles className="h-4 w-4" />} description={rec.data ? `~${rec.data.estMinutes} minutes` : undefined} />
            <CardBody>
              <ol className="space-y-2">
                {(rec.data?.items ?? []).slice(0, 4).map((it, i) => (
                  <li key={`${it.itemType}:${it.itemId}`} className="flex items-center gap-2.5 text-[13px]">
                    <span className="w-4 font-mono text-[11.5px] text-faint">{i + 1}.</span>
                    {it.itemType === "question" ? <ListChecks className="h-3.5 w-3.5 shrink-0 text-accent-600" /> : <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1 truncate">{it.reason}</span>
                    <span className="font-mono text-[11px] text-faint">{it.itemId.toUpperCase()}</span>
                  </li>
                ))}
              </ol>
              <Link href={`/kits/${kit.id}/practice`} className={buttonClass("primary", "md", "mt-4 w-full")}>
                <Play className="h-4 w-4" /> Start Session
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Strong areas" />
            <CardBody className="space-y-3">
              {readiness.strongAreas.length === 0 ? (
                <p className="text-[13px] text-muted">Areas reach this list at 75% readiness.</p>
              ) : (
                readiness.strongAreas.map((s) => (
                  <div key={s.requirementId}>
                    <div className="mb-1 flex justify-between text-[13px]">
                      <span className="truncate font-medium">{s.topic}</span>
                      <span className="tabular-nums text-muted">{s.readiness}%</span>
                    </div>
                    <ProgressBar value={s.readiness} tone="good" size="sm" />
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          <Card className="p-5">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setFormulaOpen((o) => !o)} aria-expanded={formulaOpen}>
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                <Info className="h-4 w-4 text-muted" /> How is this calculated?
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted transition-transform", formulaOpen && "rotate-180")} />
            </button>
            {formulaOpen && (
              <div className="mt-3 animate-fade-in space-y-3 text-[12.5px] leading-relaxed text-ink-2">
                <p>Scores are computed by deterministic code from your ratings — the AI never judges you.</p>
                <div>
                  <SectionLabel>Readiness per requirement</SectionLabel>
                  <code className="mt-1 block rounded-lg bg-subtle p-2.5 font-mono text-[11.5px]">
                    70% × mastery + 20% × practised share + 10% × freshness
                  </code>
                </div>
                <div>
                  <SectionLabel>Weak-spot ranking</SectionLabel>
                  <code className="mt-1 block rounded-lg bg-subtle p-2.5 font-mono text-[11.5px]">
                    (100 − readiness) × priority (must 1.0 · nice 0.6) × difficulty (0.9–1.1)
                  </code>
                </div>
                <p className="text-muted">Mastery = (confidence − 1) / 4, where confidence blends your latest rating (70%) with your history (30%). Freshness decays to zero over 7 days.</p>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {readiness.requirements.length > 0 && (
        <section>
          <h2 className="mb-3 text-[16px] font-semibold tracking-[-0.015em]">All requirements</h2>
          <Card className="divide-y divide-line">
            {[...readiness.requirements].sort((a, b) => b.weakness - a.weakness).map((r) => (
              <div key={r.requirementId} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[auto_1.2fr_1fr_auto]">
                <IdTag>{r.requirementId}</IdTag>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium">{r.topic}</div>
                  <div className="text-[11.5px] uppercase tracking-[0.06em] text-faint">{r.priority}</div>
                </div>
                <ProgressBar value={r.readiness} tone="auto" size="sm" className="hidden sm:block" />
                <button onClick={() => setRepair(r.requirementId)} disabled={r.itemsTotal === 0} className="flex items-center gap-1 text-[12.5px] font-medium text-accent-700 hover:underline disabled:opacity-40">
                  {r.readiness}% <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            ))}
          </Card>
        </section>
      )}

      <RepairSession key={repair ?? "none"} requirementId={repair} onClose={() => setRepair(null)} onNext={(rid) => setRepair(rid)} />
    </div>
  );
}
