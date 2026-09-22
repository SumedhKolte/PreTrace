"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Minus, RotateCcw, X } from "lucide-react";
import { PIPELINE_STAGES, type GenerationStatus, type StageState } from "@preptrace/shared";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { cn, hostOf } from "@/lib/utils";

function Elapsed({ since }: { since?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

function StageIcon({ status }: { status: StageState["status"] }) {
  if (status === "done")
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good text-white">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  if (status === "running")
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-100">
        <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-accent-500" />
      </span>
    );
  if (status === "failed")
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bad text-white">
        <X className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  if (status === "skipped")
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-subtle text-faint">
        <Minus className="h-3 w-3" />
      </span>
    );
  return <span className="h-6 w-6 rounded-full border-2 border-line bg-surface" />;
}

/**
 * Animated pipeline timeline. Mirrors the backend stages exactly (shared PIPELINE_STAGES)
 * and shows the meaningful status text each stage reports.
 */
export function GenerationTimeline({
  status,
  companyUrl,
  onRetry,
  retrying,
}: {
  status: GenerationStatus | null | undefined;
  companyUrl: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const stages: StageState[] = status?.stages?.length
    ? status.stages
    : PIPELINE_STAGES.map((s) => ({ key: s.key, label: s.label, status: "pending" as const }));
  const failed = status?.status === "failed";
  const events = [...(status?.events ?? [])].reverse().slice(0, 9);
  const current = stages.find((s) => s.status === "running");

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em]">{failed ? "Generation stopped" : "Building your prep kit"}</h2>
            <p className="mt-1 text-[13.5px] text-muted">
              {failed ? "Nothing was saved from this run. You can retry safely." : current ? `${current.label}…` : status?.status === "queued" ? "Waiting for a worker…" : "Starting…"}
            </p>
          </div>
          <div className="text-right text-[12.5px] text-muted">
            <div className="text-[20px] font-semibold tabular-nums text-ink">{status?.progress ?? 0}%</div>
            <Elapsed since={status?.startedAt ?? status?.createdAt} />
          </div>
        </div>
        <ProgressBar value={failed ? 100 : status?.progress ?? 2} tone={failed ? "bad" : "accent"} className="mt-4" label="Generation progress" />

        <ol className="mt-6" aria-live="polite">
          {stages.map((s, i) => (
            <li key={s.key} className="relative flex gap-3.5 pb-5 last:pb-0">
              {i < stages.length - 1 && <span className={cn("absolute left-[11px] top-7 h-[calc(100%-22px)] w-0.5 rounded-full", s.status === "done" || s.status === "skipped" ? "bg-good/35" : "bg-line")} aria-hidden />}
              <StageIcon status={s.status} />
              <div className="min-w-0 flex-1 pt-0.5">
                <div className={cn("text-[14px] font-medium", s.status === "pending" ? "text-faint" : s.status === "skipped" ? "text-muted" : "text-ink")}>{s.label}</div>
                {s.detail && s.status !== "pending" && <div className={cn("mt-0.5 animate-fade-in text-[12.5px] leading-relaxed", s.status === "failed" ? "text-bad" : "text-muted")}>{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-4">
        {failed && (
          <div role="alert" className="rounded-2xl border border-[#f4d1cc] bg-bad-soft p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-bad">
              <AlertTriangle className="h-4 w-4" /> {status?.error?.code?.replace(/_/g, " ") ?? "Generation failed"}
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink-2">{status?.error?.message}</p>
            {onRetry && (
              <Button className="mt-4" variant="dark" onClick={onRetry} loading={retrying} icon={<RotateCcw className="h-4 w-4" />}>
                Retry generation
              </Button>
            )}
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-night-line bg-night text-white">
          <div className="flex items-center justify-between border-b border-night-line px-4 py-3">
            <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/50">Live activity</span>
            <span className="font-mono text-[11.5px] text-white/40">{hostOf(companyUrl)}</span>
          </div>
          <ul className="max-h-[420px] space-y-0 overflow-y-auto p-2 font-mono text-[12px]">
            {events.length === 0 && <li className="px-2 py-3 text-white/40">Waiting for the first stage…</li>}
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className={cn("flex gap-3 rounded-lg px-2 py-1.5", i === 0 && !failed && "animate-rise bg-white/5")}>
                <span className="shrink-0 text-white/30">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className={cn("leading-relaxed", e.level === "error" ? "text-[#ff9b8f]" : i === 0 ? "text-white" : "text-white/65")}>{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="px-1 text-[12.5px] leading-relaxed text-muted">
          You can leave this page — generation continues in the background and your dashboard shows live progress.
        </p>
      </div>
    </div>
  );
}
