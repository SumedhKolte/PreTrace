"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { CONFIDENCE_LABELS, type WorkspaceFlashcard, type WorkspaceQuestion } from "@preptrace/shared";
import { Kbd } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATEGORY_META, DifficultyDots } from "./labels";

export type PracticeSubject =
  | { type: "question"; item: WorkspaceQuestion }
  | { type: "flashcard"; item: WorkspaceFlashcard }
  | { type: "followup"; item: { prompt: string; answer_outline: string } };

/**
 * One practice card: front → reveal → confidence (1–5).
 * Keyboard: Space/Enter reveals, 1–5 rates.
 */
export function PracticeItemView({ subject, onRate, busy, label }: { subject: PracticeSubject; onRate: (confidence: number) => void; busy?: boolean; label?: string }) {
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const key = subject.type === "followup" ? subject.item.prompt : subject.item.id;

  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setRevealed(false);
    setPicked(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog] input")) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && !busy && /^[1-5]$/.test(e.key)) {
        setPicked(Number(e.key));
        onRate(Number(e.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, busy, onRate]);

  const front = subject.type === "flashcard" ? subject.item.front : subject.item.prompt;
  const back = subject.type === "flashcard" ? subject.item.back : subject.item.answer_outline;
  const cat = subject.type === "question" ? CATEGORY_META[subject.item.category] : null;

  return (
    <div className="animate-rise">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-[12px]">
          <span className="font-semibold uppercase tracking-[0.08em] text-faint">{label ?? (subject.type === "flashcard" ? "Flashcard" : subject.type === "followup" ? "Follow-up question" : "Interview question")}</span>
          {cat && (
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ${cat.soft}`}>
              <cat.icon className="h-3 w-3" /> {cat.label}
            </span>
          )}
          {subject.type === "question" && <DifficultyDots value={subject.item.difficulty} />}
        </div>
        <div className="px-5 py-8 sm:px-8 sm:py-10">
          <p className="text-balance text-[19px] font-medium leading-snug tracking-[-0.015em] sm:text-[21px]">{front}</p>
        </div>
        {revealed && (
          <div className="animate-fade-in border-t border-night-line bg-night px-5 py-6 text-white sm:px-8">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">{subject.type === "flashcard" ? "Answer" : "What a strong answer covers"}</div>
            <div className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/85">{back}</div>
          </div>
        )}
      </div>

      <div className="mt-5">
        {!revealed ? (
          <div className="flex flex-col items-center gap-2">
            <Button variant="dark" size="lg" onClick={() => setRevealed(true)} icon={<Eye className="h-4 w-4" />}>
              Reveal Answer
            </Button>
            <span className="hidden text-[12px] text-muted sm:block">
              Answer out loud first, then press <Kbd>Space</Kbd>
            </span>
          </div>
        ) : (
          <div className="animate-fade-in">
            <div className="mb-2.5 text-center text-[13.5px] font-medium">How confident are you?</div>
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
                    "flex flex-col items-center gap-1 rounded-xl border px-1 py-3 transition-all active:scale-[0.97] disabled:opacity-60",
                    picked === n ? "border-accent-500 bg-accent-50 ring-4 ring-accent-100" : "border-line bg-surface hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card",
                  )}
                >
                  <span className={cn("text-[18px] font-semibold tabular-nums", n <= 2 ? "text-bad" : n === 3 ? "text-warn" : "text-good")}>{n}</span>
                  <span className="text-center text-[10.5px] leading-tight text-muted sm:text-[11.5px]">{CONFIDENCE_LABELS[n]}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 hidden text-center text-[12px] text-muted sm:block">
              Press <Kbd>1</Kbd>–<Kbd>5</Kbd>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
