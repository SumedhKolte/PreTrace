"use client";

import { useEffect, useState } from "react";
import { Check, CornerDownRight, Eye, Loader2, Sparkles } from "lucide-react";
import { CONFIDENCE_LABELS, type AnswerCritique, type WorkspaceFlashcard, type WorkspaceQuestion } from "@preptrace/shared";
import { Kbd } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useKitCtx } from "./kit-context";
import { CATEGORY_META, DifficultyDots } from "./labels";
import { AnswerPad } from "./practice/answer-pad";
import { CritiquePanel } from "./practice/critique-panel";
import { SessionTimer } from "./practice/session-timer";

export type PracticeSubject =
  | { type: "question"; item: WorkspaceQuestion }
  | { type: "flashcard"; item: WorkspaceFlashcard }
  | { type: "followup"; item: { prompt: string; answer_outline: string } };

/** Same splitting rule as the API's critique rubric, so ticks line up with covered points. */
function rubricPoints(outline: string): string[] {
  return outline
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter((l) => l.length > 2)
    .slice(0, 12);
}

/**
 * One practice card, built for active recall:
 *   1. attempt — type or dictate an answer (the rubric stays hidden)
 *   2. critique (optional) — AI marks covered rubric points, strengths, blind spots, a curveball
 *   3. reveal — the ideal rubric un-blurs, with covered points ticked
 *   4. rate — 1–5 confidence (drives deterministic readiness)
 * Keyboard: Space/Enter reveals (outside text fields), 1–5 rates.
 */
export function PracticeItemView({
  subject,
  onRate,
  busy,
  label,
  timerSeconds = 0,
  sound = false,
  requirementIds = [],
}: {
  subject: PracticeSubject;
  onRate: (confidence: number) => void;
  busy?: boolean;
  label?: string;
  timerSeconds?: number;
  sound?: boolean;
  /** For follow-up subjects: requirements of the question they came from. */
  requirementIds?: string[];
}) {
  const { kit } = useKitCtx();
  const key = subject.type === "followup" ? subject.item.prompt : subject.item.id;
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [critique, setCritique] = useState<AnswerCritique | null>(null);
  const [critiquing, setCritiquing] = useState(false);
  const [critiqueError, setCritiqueError] = useState<string | null>(null);
  const [drill, setDrill] = useState<string | null>(null);

  // Reset per card (state adjusted during render; no effect needed).
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setRevealed(false);
    setPicked(null);
    setAnswer("");
    setCritique(null);
    setCritiqueError(null);
    setDrill(null);
  }

  const canRate = revealed || critique !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!revealed && (e.key === " " || e.key === "Spacebar" || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (canRate && !busy && /^[1-5]$/.test(e.key)) {
        setPicked(Number(e.key));
        onRate(Number(e.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, canRate, busy, onRate]);

  const front = subject.type === "flashcard" ? subject.item.front : subject.item.prompt;
  const back = subject.type === "flashcard" ? subject.item.back : subject.item.answer_outline;
  const cat = subject.type === "question" ? CATEGORY_META[subject.item.category] : null;
  const points = subject.type === "flashcard" ? [] : rubricPoints(back);
  const canCritique = subject.type !== "flashcard";

  async function runCritique() {
    setCritiquing(true);
    setCritiqueError(null);
    try {
      const body =
        subject.type === "question"
          ? { itemType: "question", itemId: subject.item.id, answer }
          : { itemType: "followup", prompt: front, answer_outline: back, requirementIds, answer };
      const res = await api<{ critique: AnswerCritique }>(`/kits/${kit.id}/practice/critique`, { body });
      setCritique(res.critique);
    } catch (e) {
      setCritiqueError(e instanceof ApiError ? e.message : "Couldn't get feedback right now.");
    } finally {
      setCritiquing(false);
    }
  }

  const drillReqs = subject.type === "question" ? subject.item.requirement_ids : requirementIds;

  return (
    <div className="animate-rise space-y-4">
      <div className="card overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-[12px]">
          <span className="font-semibold uppercase tracking-[0.08em] text-faint">
            {label ?? (subject.type === "flashcard" ? "Flashcard" : subject.type === "followup" ? "Follow-up question" : "Interview question")}
          </span>
          {cat && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${cat.soft}`}>
              <cat.icon className="h-3 w-3" /> #{cat.label.replace(/\s+/g, "")}
            </span>
          )}
          {subject.type === "question" && <DifficultyDots value={subject.item.difficulty} />}
          <span className="ml-auto">{timerSeconds > 0 && <SessionTimer key={key} seconds={timerSeconds} running={!revealed && !critique} sound={sound} />}</span>
        </div>

        {/* Question */}
        <div className="px-5 pb-6 pt-7 sm:px-8">
          <p className="text-balance text-[19px] font-medium leading-snug tracking-[-0.015em] sm:text-[21px]">{front}</p>
        </div>

        {/* Attempt */}
        <div className="border-t border-line bg-canvas/60 px-5 py-5 sm:px-8">
          <AnswerPad
            id={`answer-${key}`}
            value={answer}
            onChange={setAnswer}
            placeholder={subject.type === "flashcard" ? "Recall it in your own words first (optional)…" : undefined}
          />
          {critiqueError && <p className="mt-2 text-[13px] text-bad">{critiqueError}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canCritique && (
              <Button
                variant="primary"
                onClick={runCritique}
                loading={critiquing}
                disabled={answer.trim().length < 15}
                icon={<Sparkles className="h-4 w-4" />}
                title={answer.trim().length < 15 ? "Write or dictate a little more first" : undefined}
              >
                {critique ? "Critique again" : "Critique my answer"}
              </Button>
            )}
            {!revealed && (
              <Button variant={canCritique ? "secondary" : "dark"} onClick={() => setRevealed(true)} icon={<Eye className="h-4 w-4" />}>
                Reveal {subject.type === "flashcard" ? "answer" : "ideal answer"}
              </Button>
            )}
            <span className="hidden text-[12px] text-muted md:inline">
              Attempt first — active recall beats re-reading. <Kbd>Space</Kbd> reveals.
            </span>
          </div>
        </div>

        {/* Critique */}
        {(critique || critiquing) && (
          <div className="border-t border-line px-5 py-5 sm:px-8">
            {critiquing && !critique ? (
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Reviewing your answer against the rubric…
              </div>
            ) : (
              critique && <CritiquePanel critique={critique} onDrill={subject.type === "question" ? setDrill : undefined} drilling={!!drill} />
            )}
          </div>
        )}

        {/* Reveal: blur-to-clear rubric */}
        {revealed && (
          <div className="relative animate-unblur border-t border-accent-100 bg-[linear-gradient(180deg,var(--color-accent-50),var(--color-surface))] px-5 py-5 sm:px-8">
            <span className="absolute inset-y-5 left-0 w-1 rounded-r-full bg-brand-gradient" aria-hidden />
            <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-accent-700">
              {subject.type === "flashcard" ? "Answer" : "What a strong answer covers"}
            </div>
            {points.length ? (
              <ul className="mt-2.5 space-y-1.5">
                {points.map((p, i) => {
                  const hit = critique?.coveredPoints.includes(i);
                  return (
                    <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-ink">
                      <span className={cn("mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full", hit ? "bg-good text-white" : "border border-line-strong bg-surface")}>
                        {hit && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                      </span>
                      {p}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-ink">{back || "No rubric for this follow-up — use the critique above."}</div>
            )}
          </div>
        )}
      </div>

      {drill && <FollowUpDrill prompt={drill} requirementIds={drillReqs} onDone={() => setDrill(null)} />}

      {canRate && (
        <div className="animate-fade-in">
          <div className="mb-2.5 text-center text-[13.5px] font-medium">How confident are you now?</div>
          <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Confidence">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={picked === n}
                disabled={busy}
                onClick={() => {
                  setPicked(n);
                  onRate(n);
                }}
                className={cn(
                  "group flex flex-col items-center gap-1.5 rounded-xl border px-1 py-3 transition-all active:scale-[0.97] disabled:opacity-60",
                  picked === n ? "border-accent-500 bg-accent-50 ring-4 ring-accent-100" : "border-line bg-surface hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg border border-b-[3px] bg-surface font-mono text-[15px] font-semibold tabular-nums shadow-[0_1px_0_var(--color-line)] transition-transform group-active:translate-y-px",
                    n <= 2 ? "border-[#f3c5c0] text-bad" : n === 3 ? "border-[#f5dca8] text-warn" : "border-[#bfe8cd] text-good",
                  )}
                  aria-hidden
                >
                  {n}
                </span>
                <span className="text-center text-[10.5px] leading-tight text-muted sm:text-[11.5px]">{CONFIDENCE_LABELS[n]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Answer the interviewer's curveball; critiqued without a rubric (strengths / gaps only). */
function FollowUpDrill({ prompt, requirementIds, onDone }: { prompt: string; requirementIds: string[]; onDone: () => void }) {
  const { kit } = useKitCtx();
  const [answer, setAnswer] = useState("");
  const [critique, setCritique] = useState<AnswerCritique | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ critique: AnswerCritique }>(`/kits/${kit.id}/practice/critique`, {
        body: { itemType: "followup", prompt, answer_outline: "", requirementIds, answer },
      });
      setCritique(res.critique);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't get feedback right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card animate-rise overflow-hidden">
      <div className="night-surface px-5 py-4 text-white sm:px-8">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-cyan">
          <CornerDownRight className="h-3.5 w-3.5" /> Follow-up drill
        </div>
        <p className="mt-1 text-[16px] font-medium leading-snug">{prompt}</p>
      </div>
      <div className="space-y-3 px-5 py-5 sm:px-8">
        <AnswerPad id={`drill-${prompt.slice(0, 12)}`} value={answer} onChange={setAnswer} placeholder="How would you handle this curveball?" />
        {error && <p className="text-[13px] text-bad">{error}</p>}
        <div className="flex gap-2">
          <Button variant="primary" loading={busy} disabled={answer.trim().length < 15} onClick={run} icon={<Sparkles className="h-4 w-4" />}>
            Critique follow-up
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        </div>
        {critique && <CritiquePanel critique={critique} />}
      </div>
    </div>
  );
}
