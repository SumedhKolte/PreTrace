import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, Clock, Loader2 } from "lucide-react";
import { PIPELINE_STAGES, type KitSummary } from "@preptrace/shared";
import { Badge } from "@/components/ui/badge";
import { ProgressBar, ReadinessRing } from "@/components/ui/progress";
import { daysUntil, hostOf, relativeTime } from "@/lib/utils";

export function KitCard({ kit, index = 0 }: { kit: KitSummary; index?: number }) {
  const left = daysUntil(kit.interviewDate);
  const generating = kit.status === "generating";
  const stageLabel = PIPELINE_STAGES.find((s) => s.key === kit.job?.currentStage)?.label;
  return (
    <Link
      href={`/kits/${kit.id}`}
      className="card group flex animate-rise flex-col p-5 transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-subtle text-[11px] font-semibold text-ink-2">{kit.company[0]?.toUpperCase()}</span>
            <span className="truncate">{kit.company}</span>
          </div>
          <h3 className="mt-2 line-clamp-2 text-[16px] font-semibold leading-snug tracking-[-0.015em] text-ink">{kit.role}</h3>
        </div>
        {!generating && kit.status !== "failed" && <ReadinessRing value={kit.readiness} size={52} stroke={5} />}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {generating ? (
          <Badge tone="accent" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
            Generating
          </Badge>
        ) : kit.status === "failed" ? (
          <Badge tone="bad" icon={<AlertTriangle className="h-3 w-3" />}>
            Failed
          </Badge>
        ) : (
          <Badge tone={left !== null && left <= 2 ? "warn" : "neutral"} icon={<CalendarClock className="h-3 w-3" />}>
            {left === 0 ? "Interview today" : `Interview in ${left} day${left === 1 ? "" : "s"}`}
          </Badge>
        )}
        {kit.weakSpotCount > 0 && !generating && <Badge tone="bad">{kit.weakSpotCount} weak spots</Badge>}
        {kit.status === "partial" && <Badge tone="warn">Partial</Badge>}
      </div>

      <div className="mt-5 flex-1">
        {generating ? (
          <div>
            <div className="mb-1.5 flex justify-between text-[12px] text-muted">
              <span className="truncate">{stageLabel ?? "Queued"}…</span>
              <span className="tabular-nums">{kit.job?.progress ?? 0}%</span>
            </div>
            <ProgressBar value={kit.job?.progress ?? 3} />
          </div>
        ) : kit.status === "failed" ? (
          <p className="text-[13px] text-muted">Generation didn&apos;t complete. Open to see why and retry.</p>
        ) : (
          <div>
            <div className="mb-1.5 flex justify-between text-[12px] text-muted">
              <span>Readiness</span>
              <span className="tabular-nums">
                {kit.questionCount} questions · {kit.flashcardCount} cards
              </span>
            </div>
            <ProgressBar value={kit.readiness} tone="auto" />
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-line pt-3.5 text-[12.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {generating ? hostOf(kit.companyUrl) : kit.lastPracticedAt ? `Practised ${relativeTime(kit.lastPracticedAt).toLowerCase()}` : "Not practised yet"}
        </span>
        <span className="flex items-center gap-1 font-medium text-ink group-hover:text-accent-700">
          {generating ? "Watch" : kit.status === "failed" ? "Details" : "Continue"} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
