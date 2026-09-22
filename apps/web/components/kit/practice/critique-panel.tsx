"use client";

import { AlertTriangle, CheckCircle2, CornerDownRight, Quote, Zap } from "lucide-react";
import { VERDICT_LABELS, type AnswerCritique } from "@preptrace/shared";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VERDICT_TONE: Record<AnswerCritique["verdict"], Tone> = { strong: "good", solid: "accent", developing: "warn", needs_work: "bad" };

/** AI critique of a drafted answer. Advisory: it never changes readiness scores. */
export function CritiquePanel({ critique, onDrill, drilling }: { critique: AnswerCritique; onDrill?: (followUp: string) => void; drilling?: boolean }) {
  const hasRubric = critique.outlinePoints.length > 0;
  return (
    <div className="animate-unblur space-y-4">
      {hasRubric && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={VERDICT_TONE[critique.verdict]}>{VERDICT_LABELS[critique.verdict]}</Badge>
          <div className="flex items-center gap-1" aria-label={`Covered ${critique.coveredPoints.length} of ${critique.outlinePoints.length} key points`}>
            {critique.outlinePoints.map((_, i) => (
              <span key={i} className={cn("h-1.5 w-5 rounded-full", critique.coveredPoints.includes(i) ? "bg-good" : "bg-sunken")} />
            ))}
          </div>
          <span className="text-[12.5px] text-muted">
            Covered {critique.coveredPoints.length} of {critique.outlinePoints.length} key points
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#c9f0d6] bg-good-soft/60 p-3.5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-good">
            <CheckCircle2 className="h-3.5 w-3.5" /> Strengths
          </div>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-2">
            {critique.strengths.length ? critique.strengths.map((s) => <li key={s}>{s}</li>) : <li className="text-muted">Nothing specific yet — add more detail.</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-[#fbe3b8] bg-warn-soft/60 p-3.5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-warn">
            <AlertTriangle className="h-3.5 w-3.5" /> Blind spots
          </div>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-2">
            {critique.gaps.length ? critique.gaps.map((s) => <li key={s}>{s}</li>) : <li className="text-muted">No major gaps spotted.</li>}
          </ul>
        </div>
      </div>

      {critique.staffPhrasing && (
        <figure className="relative rounded-xl border border-accent-100 bg-accent-50/60 p-4 pl-5">
          <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-brand-gradient" aria-hidden />
          <figcaption className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent-700">
            <Quote className="h-3.5 w-3.5" /> How a stronger candidate would put it
          </figcaption>
          <blockquote className="mt-2 text-[13.5px] leading-relaxed text-ink">{critique.staffPhrasing}</blockquote>
        </figure>
      )}

      {critique.followUp && (
        <div className="night-surface flex flex-col gap-3 rounded-xl border border-night-line p-4 text-white sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-cyan">
              <Zap className="h-3.5 w-3.5" /> Interviewer curveball
            </div>
            <p className="mt-1 text-[14px] leading-snug text-white/90">{critique.followUp}</p>
          </div>
          {onDrill && !drilling && (
            <Button size="sm" variant="secondary" icon={<CornerDownRight className="h-3.5 w-3.5" />} onClick={() => onDrill(critique.followUp)}>
              Answer it
            </Button>
          )}
        </div>
      )}
      <p className="text-[11.5px] text-faint">AI feedback is advisory — your readiness score comes only from your own confidence ratings.</p>
    </div>
  );
}
