"use client";

import { useState } from "react";
import { AlertTriangle, CalendarRange, Clock, Lock, LockOpen, Minus, Pencil, Plus, RefreshCw, X } from "lucide-react";
import type { WorkspaceScheduleDay } from "@preptrace/shared";
import { liveQuestions, useKitCtx } from "@/components/kit/kit-context";
import { CATEGORY_META, DifficultyDots } from "@/components/kit/labels";
import { RegenerateDialog } from "@/components/kit/regenerate-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/overlay";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { cn, minutesLabel } from "@/lib/utils";

const KIND = {
  learn: { label: "Learn", tone: "accent" as const },
  review: { label: "Review", tone: "neutral" as const },
  mock: { label: "Mock", tone: "dark" as const },
};

export default function SchedulePage() {
  const { kit, mutate, patchLocal } = useKitCtx();
  const toast = useToast();
  const [regen, setRegen] = useState(false);
  const days = kit.schedule.days;
  const total = days.reduce((s, d) => s + d.minutes, 0);
  const questions = liveQuestions(kit);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const scheduled = new Set(days.flatMap((d) => d.question_ids));
  const unscheduled = questions.filter((q) => !scheduled.has(q.id));
  const maxMinutes = Math.max(...days.map((d) => d.minutes), 1);

  async function updateDay(day: number, patch: Partial<Pick<WorkspaceScheduleDay, "focus" | "minutes" | "question_ids" | "locked">>) {
    patchLocal((k) => ({
      ...k,
      schedule: {
        ...k.schedule,
        days: k.schedule.days.map((d) => (d.day === day ? { ...d, ...patch, locked: patch.locked ?? (patch.focus !== undefined || patch.minutes !== undefined || patch.question_ids !== undefined ? true : d.locked) } : d)),
      },
    }));
    try {
      await api(`/kits/${kit.id}/schedule/days/${day}`, { method: "PATCH", body: patch });
    } catch (e) {
      toast.error("Couldn't update day", e instanceof ApiError ? e.message : undefined);
    } finally {
      void mutate();
    }
  }

  if (days.length === 0) return <EmptyState icon={<CalendarRange />} title="No schedule yet" description="Rebuild the schedule to plan your days." action={<Button onClick={() => setRegen(true)}>Build schedule</Button>} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <Badge tone="dark">{days.length} days</Badge>
          <span>{minutesLabel(total)} total</span>
          <span className="text-faint">·</span>
          <span>{questions.length} questions</span>
          <span className="text-faint">·</span>
          <Tooltip content="Days are allocated by code, not the AI: hard and must-have questions come first, review days rotate, the last day is a mock interview.">
            <span className="cursor-help underline decoration-dotted underline-offset-2">Deterministic plan</span>
          </Tooltip>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRegen(true)}>
          Rebuild schedule
        </Button>
      </div>

      {(kit.schedule.stale || unscheduled.length > 0) && (
        <div className="flex flex-col gap-3 rounded-xl border border-[#fbe3b8] bg-warn-soft px-4 py-3 sm:flex-row sm:items-center">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
          <p className="flex-1 text-[13px] text-ink-2">
            {unscheduled.length > 0 ? `${unscheduled.length} question(s) aren't in the plan yet.` : "Your questions changed since this plan was built."} Rebuild to include them — days you edited stay locked.
          </p>
          <Button size="sm" variant="dark" onClick={() => setRegen(true)}>
            Rebuild
          </Button>
        </div>
      )}

      <ol className="relative space-y-3">
        {days.map((d) => (
          <DayCard key={d.day} day={d} max={maxMinutes} total={days.length} byId={byId} allQuestions={questions} onUpdate={(p) => updateDay(d.day, p)} />
        ))}
      </ol>
      <RegenerateDialog scope={regen ? "schedule" : null} onClose={() => setRegen(false)} />
    </div>
  );
}

function DayCard({
  day: d,
  max,
  total,
  byId,
  allQuestions,
  onUpdate,
}: {
  day: WorkspaceScheduleDay;
  max: number;
  total: number;
  byId: Map<string, ReturnType<typeof liveQuestions>[number]>;
  allQuestions: ReturnType<typeof liveQuestions>;
  onUpdate: (p: Partial<Pick<WorkspaceScheduleDay, "focus" | "minutes" | "question_ids" | "locked">>) => void;
}) {
  const [open, setOpen] = useState(d.day === 1);
  const [editingFocus, setEditingFocus] = useState(false);
  const [focus, setFocus] = useState(d.focus);
  const [adding, setAdding] = useState("");
  const kind = KIND[d.kind];
  const qs = d.question_ids.map((id) => byId.get(id)).filter(Boolean) as ReturnType<typeof liveQuestions>;

  return (
    <li className="card overflow-hidden">
      <div className="flex items-stretch">
        <div className={cn("flex w-20 shrink-0 flex-col items-center justify-center border-r border-line py-4", d.kind === "mock" ? "bg-night text-white" : "bg-subtle")}>
          <span className={cn("text-[10.5px] font-semibold uppercase tracking-[0.1em]", d.kind === "mock" ? "text-white/50" : "text-faint")}>Day</span>
          <span className="text-[26px] font-semibold leading-none tabular-nums tracking-[-0.03em]">{d.day}</span>
          <span className={cn("mt-1 text-[10.5px]", d.kind === "mock" ? "text-white/40" : "text-faint")}>of {total}</span>
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {editingFocus ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (focus.trim()) onUpdate({ focus: focus.trim() });
                    setEditingFocus(false);
                  }}
                  className="flex gap-2"
                >
                  <Input value={focus} onChange={(e) => setFocus(e.target.value)} className="h-8" autoFocus aria-label="Day focus" onBlur={() => setEditingFocus(false)} />
                </form>
              ) : (
                <button className="group flex items-center gap-1.5 text-left" onClick={() => { setFocus(d.focus); setEditingFocus(true); }}>
                  <span className="text-[15px] font-semibold tracking-[-0.01em]">{d.focus}</span>
                  <Pencil className="h-3 w-3 text-faint opacity-0 group-hover:opacity-100" />
                </button>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                <Badge tone={kind.tone}>{kind.label}</Badge>
                <span>{qs.length} question{qs.length === 1 ? "" : "s"}</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <button aria-label="Decrease minutes" className="rounded p-0.5 hover:bg-subtle" onClick={() => onUpdate({ minutes: Math.max(5, d.minutes - 5) })}>
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="tabular-nums">{d.minutes} min</span>
                  <button aria-label="Increase minutes" className="rounded p-0.5 hover:bg-subtle" onClick={() => onUpdate({ minutes: Math.min(600, d.minutes + 5) })}>
                    <Plus className="h-3 w-3" />
                  </button>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip content={d.locked ? "Locked: kept verbatim when you rebuild the schedule. Click to unlock." : "Lock this day so rebuilding keeps it."}>
                <Button variant="ghost" size="icon" aria-label={d.locked ? "Unlock day" : "Lock day"} onClick={() => onUpdate({ locked: !d.locked })}>
                  {d.locked ? <Lock className="h-4 w-4 text-accent-600" /> : <LockOpen className="h-4 w-4" />}
                </Button>
              </Tooltip>
              <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? "Hide" : "Questions"}
              </Button>
            </div>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-sunken">
            <div className={cn("h-full rounded-full", d.kind === "mock" ? "bg-night" : d.kind === "review" ? "bg-line-strong" : "bg-accent-400")} style={{ width: `${(d.minutes / max) * 100}%` }} />
          </div>
          {open && (
            <div className="mt-3 animate-fade-in space-y-1.5">
              {qs.map((q) => {
                const meta = CATEGORY_META[q.category];
                return (
                  <div key={q.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-subtle">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} title={meta.label} />
                    <span className="font-mono text-[11px] text-faint">{q.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{q.prompt}</span>
                    <DifficultyDots value={q.difficulty} />
                    <button aria-label={`Remove ${q.id} from day ${d.day}`} className="rounded p-1 text-faint opacity-0 hover:bg-sunken hover:text-bad focus:opacity-100 group-hover:opacity-100" onClick={() => onUpdate({ question_ids: d.question_ids.filter((x) => x !== q.id) })}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              <div className="flex gap-2 pt-1">
                <Select value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8 text-[12.5px]" aria-label="Add a question to this day">
                  <option value="">Add a question to this day…</option>
                  {allQuestions.filter((q) => !d.question_ids.includes(q.id)).map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.id} — {q.prompt.slice(0, 70)}
                    </option>
                  ))}
                </Select>
                <Button size="sm" disabled={!adding} onClick={() => { onUpdate({ question_ids: [...d.question_ids, adding] }); setAdding(""); }}>
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
