"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, TrendingUp, Wrench } from "lucide-react";
import { CONFIDENCE_LABELS, type PracticeSessionDTO, type RequirementReadiness } from "@preptrace/shared";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { ErrorState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useKitCtx } from "./kit-context";
import { PracticeItemView, type PracticeSubject } from "./practice-item";

interface RepairResult {
  before: { confidence: number | null; readiness: number };
  after: { confidence: number; readiness: number; avgConfidence: number | null };
}

const STEP_LABELS = ["Concept", "Question", "Follow-up", "Reassess"];

/**
 * Targeted repair for one weak requirement:
 * concept flashcard → interview question → follow-up probe → confidence reassessment.
 */
export function RepairSession({ requirementId, onClose, onNext }: { requirementId: string | null; onClose: () => void; onNext?: (rid: string) => void }) {
  const { kit, refreshReadiness } = useKitCtx();
  const [session, setSession] = useState<PracticeSessionDTO | null>(null);
  const [req, setReq] = useState<RequirementReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RepairResult | null>(null);
  const [nextWeak, setNextWeak] = useState<RequirementReadiness | null>(null);

  // The parent keys this component by requirementId, so state starts fresh per repair.
  useEffect(() => {
    if (!requirementId) return;
    let cancelled = false;
    api<{ session: PracticeSessionDTO; requirement: RequirementReadiness }>(`/kits/${kit.id}/weak-spots/repair`, { body: { requirementId } })
      .then((r) => {
        if (cancelled) return;
        setSession(r.session);
        setReq(r.requirement);
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Couldn't start the repair session"));
    return () => {
      cancelled = true;
    };
  }, [requirementId, kit.id]);

  const steps: (PracticeSubject | "reassess")[] = [];
  if (session) {
    for (const it of session.items) {
      if (it.itemType === "flashcard") {
        const f = kit.flashcards.find((x) => x.id === it.itemId);
        if (f) steps.push({ type: "flashcard", item: f });
      } else {
        const q = kit.questions.find((x) => x.id === it.itemId);
        if (q) steps.push({ type: "question", item: q });
      }
    }
    if (session.followUp) steps.push({ type: "followup", item: session.followUp });
    steps.push("reassess");
  }
  const current = steps[step];

  async function rateItem(confidence: number) {
    if (!session || !current || current === "reassess") return;
    setBusy(true);
    try {
      if (current.type !== "followup") {
        await api(`/kits/${kit.id}/practice/events`, { body: { sessionId: session.id, itemId: current.item.id, itemType: current.type, confidence } });
      }
      setTimeout(() => setStep((s) => s + 1), 200);
    } finally {
      setBusy(false);
    }
  }

  async function reassess(confidence: number) {
    if (!session) return;
    setBusy(true);
    try {
      const r = await api<RepairResult & { readiness: { weakSpots: RequirementReadiness[] } }>(`/kits/${kit.id}/weak-spots/repair/${session.id}/complete`, { body: { confidence } });
      setResult(r);
      setNextWeak(r.readiness.weakSpots.find((w) => w.requirementId !== requirementId) ?? null);
      refreshReadiness();
    } finally {
      setBusy(false);
    }
  }

  const close = onClose;

  return (
    <Modal open={!!requirementId} onOpenChange={(o) => !o && close()} size="lg" title={<span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-accent-600" /> {req?.topic ?? "Weak spot"} repair</span>} description={req?.text}>
      {error ? (
        <ErrorState message={error} />
      ) : !session ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13.5px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Building a targeted session…
        </div>
      ) : result ? (
        <div className="animate-rise py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-good-soft text-good">
            <TrendingUp className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-[20px] font-semibold tracking-[-0.02em]">
            {result.before.confidence !== null ? (
              <>
                {result.after.confidence > result.before.confidence ? "Improved" : result.after.confidence === Math.round(result.before.confidence) ? "Holding steady" : "Honest check-in"} from {result.before.confidence}/5 → {result.after.confidence}/5
              </>
            ) : (
              <>First rating: {result.after.confidence}/5</>
            )}
          </h3>
          <p className="mt-1.5 text-[13.5px] text-muted">{CONFIDENCE_LABELS[result.after.confidence]} on {req?.topic}.</p>
          <div className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-3">
            <div className="rounded-xl bg-subtle p-4">
              <div className="text-[12px] text-muted">Readiness before</div>
              <div className="text-[24px] font-semibold tabular-nums">{result.before.readiness}%</div>
            </div>
            <div className="rounded-xl bg-good-soft p-4">
              <div className="text-[12px] text-good">Readiness now</div>
              <div className="text-[24px] font-semibold tabular-nums text-good">{result.after.readiness}%</div>
            </div>
          </div>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Button variant="ghost" onClick={close}>
              Done
            </Button>
            {nextWeak && onNext && (
              <Button variant="dark" onClick={() => onNext(nextWeak.requirementId)}>
                Repair next: {nextWeak.topic} <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Repair steps">
            {STEP_LABELS.map((l, i) => {
              const idx = i === 3 ? steps.length - 1 : i;
              const available = i === 3 || i < steps.length - 1;
              const done = step > idx;
              const active = step === idx;
              return (
                <li key={l} className={cn("flex flex-col gap-1.5", !available && "opacity-40")}>
                  <span className={cn("h-1 rounded-full", done ? "bg-good" : active ? "bg-accent-500" : "bg-sunken")} />
                  <span className={cn("flex items-center gap-1 text-[11.5px] font-medium", active ? "text-ink" : "text-muted")}>
                    {done && <Check className="h-3 w-3 text-good" />} Step {i + 1} · {l}
                  </span>
                </li>
              );
            })}
          </ol>
          {current === "reassess" ? (
            <div className="animate-rise py-4 text-center">
              <h3 className="text-[18px] font-semibold tracking-[-0.015em]">How confident are you on {req?.topic} now?</h3>
              <p className="mt-1 text-[13.5px] text-muted">
                Before this session: {session.before !== null && session.before !== undefined ? `${session.before}/5` : "not rated yet"}
              </p>
              <div className="mx-auto mt-6 grid max-w-lg grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} disabled={busy} onClick={() => reassess(n)} className="flex flex-col items-center gap-1 rounded-xl border border-line bg-surface px-1 py-3 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card disabled:opacity-60">
                    <span className={cn("text-[18px] font-semibold", n <= 2 ? "text-bad" : n === 3 ? "text-warn" : "text-good")}>{n}</span>
                    <span className="text-[11px] leading-tight text-muted">{CONFIDENCE_LABELS[n]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : current ? (
            <PracticeItemView subject={current} onRate={rateItem} busy={busy} label={current.type === "flashcard" ? "Step 1 · Concept flashcard" : current.type === "question" ? "Step 2 · Interview question" : "Step 3 · Follow-up question"} />
          ) : null}
        </div>
      )}
    </Modal>
  );
}
