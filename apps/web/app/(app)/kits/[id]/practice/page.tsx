"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, Circle, Clock, ListChecks, Play, RotateCcw, SkipForward, Sparkles, Trophy } from "lucide-react";
import type { PracticeSessionDTO, ReadinessReport, SessionItem } from "@preptrace/shared";
import { useKitCtx } from "@/components/kit/kit-context";
import { PracticeItemView, type PracticeSubject } from "@/components/kit/practice-item";
import { Badge, IdTag } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, SectionLabel } from "@/components/ui/card";
import { ProgressBar, ReadinessRing } from "@/components/ui/progress";
import { EmptyState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useRecommended } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type Phase = "plan" | "session" | "done";

export default function PracticePage() {
  const { kit, readiness, refreshReadiness } = useKitCtx();
  const toast = useToast();
  const [minutes, setMinutes] = useState(15);
  const rec = useRecommended(kit.id, minutes);
  const [phase, setPhase] = useState<Phase>("plan");
  const [session, setSession] = useState<PracticeSessionDTO | null>(null);
  const [index, setIndex] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [startReadiness, setStartReadiness] = useState<number | null>(null);
  const [latest, setLatest] = useState<ReadinessReport | null>(null);

  const itemFor = useCallback(
    (s: SessionItem): PracticeSubject | null => {
      if (s.itemType === "question") {
        const q = kit.questions.find((x) => x.id === s.itemId && !x.meta.deleted);
        return q ? { type: "question", item: q } : null;
      }
      const f = kit.flashcards.find((x) => x.id === s.itemId && !x.meta.deleted);
      return f ? { type: "flashcard", item: f } : null;
    },
    [kit],
  );

  async function start(filter: "recommended" | "weak" | "unseen" | "all") {
    setStarting(filter);
    try {
      const res = await api<{ session: PracticeSessionDTO }>(`/kits/${kit.id}/practice`, { body: { minutes, filter } });
      setSession(res.session);
      setIndex(0);
      setRatings({});
      setStartReadiness(readiness?.overall ?? 0);
      setPhase("session");
    } catch (e) {
      toast.error("Couldn't start session", e instanceof ApiError ? e.message : undefined);
    } finally {
      setStarting(null);
    }
  }

  const items = useMemo(() => session?.items ?? [], [session]);
  const current = items[index];

  const rate = useCallback(
    async (confidence: number) => {
      if (!session || !current || busy) return;
      setBusy(true);
      try {
        const res = await api<{ readiness: ReadinessReport }>(`/kits/${kit.id}/practice/events`, {
          body: { sessionId: session.id, itemId: current.itemId, itemType: current.itemType, confidence },
        });
        setLatest(res.readiness);
        setRatings((r) => ({ ...r, [`${current.itemType}:${current.itemId}`]: confidence }));
        if (index + 1 >= items.length) {
          await api(`/kits/${kit.id}/practice/sessions/${session.id}/complete`, { body: {} });
          refreshReadiness();
          setPhase("done");
        } else {
          setTimeout(() => setIndex((i) => i + 1), 220);
        }
      } catch (e) {
        toast.error("Couldn't save rating", e instanceof ApiError ? e.message : undefined);
      } finally {
        setBusy(false);
      }
    },
    [session, current, busy, kit.id, index, items.length, refreshReadiness, toast],
  );

  // Requirement coverage within this session: which requirements have been practised.
  const sessionReqs = useMemo(() => {
    const ids = [...new Set(items.flatMap((i) => i.requirement_ids))];
    return ids.map((id) => ({
      req: kit.role.requirements.find((r) => r.id === id),
      done: items.some((i) => i.requirement_ids.includes(id) && ratings[`${i.itemType}:${i.itemId}`] !== undefined),
    }));
  }, [items, ratings, kit.role.requirements]);

  if (phase === "session" && current) {
    const subject = itemFor(current);
    const pct = (index / items.length) * 100;
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[13px] font-medium tabular-nums text-muted">
              {index + 1} / {items.length}
            </span>
            <ProgressBar value={pct} className="flex-1" label="Session progress" />
            <Button variant="ghost" size="sm" icon={<SkipForward className="h-3.5 w-3.5" />} onClick={() => (index + 1 < items.length ? setIndex(index + 1) : setPhase("done"))}>
              Skip
            </Button>
          </div>
          <p className="mb-3 text-[12.5px] text-muted">
            <Sparkles className="mr-1 inline h-3 w-3 text-accent-600" />
            {current.reason}
          </p>
          {subject ? <PracticeItemView subject={subject} onRate={rate} busy={busy} /> : <EmptyState title="This item was deleted" action={<Button onClick={() => setIndex(index + 1)}>Next</Button>} />}
        </div>
        <aside className="space-y-4">
          <Card className="p-4">
            <SectionLabel>Covered this session</SectionLabel>
            <ul className="mt-3 space-y-2">
              {sessionReqs.map(({ req, done }) =>
                req ? (
                  <li key={req.id} className="flex items-center gap-2 text-[13px]">
                    {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-good" /> : <Circle className="h-4 w-4 shrink-0 text-line-strong" />}
                    <IdTag>{req.id}</IdTag>
                    <span className={cn("truncate", done ? "text-ink" : "text-muted")}>{req.topic}</span>
                    {req.priority === "must" && <span className="ml-auto text-[10.5px] font-semibold text-faint">MUST</span>}
                  </li>
                ) : null,
              )}
            </ul>
          </Card>
          {latest && (
            <Card className="flex items-center gap-3 p-4">
              <ReadinessRing value={latest.overall} size={48} stroke={5} />
              <div className="text-[12.5px]">
                <div className="text-muted">Readiness now</div>
                <div className="font-medium">{latest.weakSpots.length} weak spots</div>
              </div>
            </Card>
          )}
        </aside>
      </div>
    );
  }

  if (phase === "done") {
    const rated = Object.values(ratings);
    const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
    const after = latest?.overall ?? readiness?.overall ?? 0;
    return (
      <div className="mx-auto max-w-xl animate-rise text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-night text-white">
          <Trophy className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-[24px] font-semibold tracking-[-0.025em]">Session complete</h2>
        <p className="mt-1.5 text-[14px] text-muted">
          {rated.length} item{rated.length === 1 ? "" : "s"} practised · average confidence {avg.toFixed(1)}/5
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3">
          <Card className="p-5">
            <div className="text-[12px] text-muted">Readiness</div>
            <div className="mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.03em]">
              {startReadiness ?? 0}% <span className="text-faint">→</span> <span className={after > (startReadiness ?? 0) ? "text-good" : ""}>{after}%</span>
            </div>
          </Card>
          <Card className="p-5">
            <div className="text-[12px] text-muted">Weak spots</div>
            <div className="mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.03em]">{latest?.weakSpots.length ?? readiness?.weakSpots.length ?? 0}</div>
          </Card>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button variant="dark" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setPhase("plan"); void rec.mutate(); }}>
            Next session
          </Button>
          <Link href={`/kits/${kit.id}/weak-spots`} className={buttonClass("secondary", "md")}>
            See weak spots <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  // Plan
  const recItems = rec.data?.items ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader
          title="Recommended next session"
          description="Ordered by code from your confidence, priority, difficulty and recency."
          icon={<Sparkles className="h-4 w-4" />}
          action={
            <div className="flex gap-1 rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Session length">
              {[10, 15, 30].map((m) => (
                <button key={m} role="radio" aria-checked={minutes === m} onClick={() => setMinutes(m)} className={cn("h-7 rounded-md px-2.5 text-[12.5px] font-medium", minutes === m ? "bg-night text-white" : "text-muted hover:text-ink")}>
                  {m}m
                </button>
              ))}
            </div>
          }
        />
        <CardBody>
          {rec.isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : recItems.length === 0 ? (
            <EmptyState title="Nothing to practise yet" description="Add questions or flashcards to this kit." className="py-8" />
          ) : (
            <ol className="space-y-1.5">
              {recItems.map((it, i) => {
                const subj = itemFor(it);
                const text = subj ? (subj.type === "flashcard" ? subj.item.front : subj.item.prompt) : it.itemId;
                return (
                  <li key={`${it.itemType}:${it.itemId}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                    <span className="w-5 text-center font-mono text-[12px] text-faint">{i + 1}</span>
                    {it.itemType === "question" ? <ListChecks className="h-4 w-4 shrink-0 text-accent-600" /> : <BookOpen className="h-4 w-4 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">{text}</div>
                      <div className="truncate text-[12px] text-muted">{it.reason}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-faint">{it.itemId.toUpperCase()}</span>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[13px] text-muted">
              <Clock className="h-4 w-4" /> ~{rec.data?.estMinutes ?? minutes} minutes
            </span>
            <Button variant="primary" size="lg" loading={starting === "recommended"} disabled={!recItems.length} icon={<Play className="h-4 w-4" />} onClick={() => start("recommended")}>
              Start Session
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Other sessions" />
          <CardBody className="space-y-2">
            {[
              { f: "weak" as const, title: "Weak items only", body: "Cards you rated 1–2." },
              { f: "unseen" as const, title: "Unseen items", body: "Everything you haven't tried yet." },
            ].map((o) => (
              <button key={o.f} onClick={() => start(o.f)} disabled={!!starting} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-subtle">
                <span>
                  <span className="block text-[13.5px] font-medium">{o.title}</span>
                  <span className="block text-[12.5px] text-muted">{o.body}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-muted" />
              </button>
            ))}
          </CardBody>
        </Card>
        {readiness && (
          <Card className="flex items-center gap-4 p-5">
            <ReadinessRing value={readiness.overall} size={64} stroke={6} />
            <div>
              <div className="text-[13.5px] font-medium">
                {readiness.practicedItems} of {readiness.totalItems} items practised
              </div>
              <div className="mt-0.5 text-[12.5px] text-muted">Weakest: {readiness.weakSpots[0]?.topic ?? "—"}</div>
              {readiness.weakSpots.length > 0 && <Badge tone="bad" className="mt-2">{readiness.weakSpots.length} weak spots</Badge>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
