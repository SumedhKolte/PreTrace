"use client";

import { Keyboard, Mic, MicOff } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@/components/ui/overlay";
import { useDictation } from "@/lib/useDictation";
import { cn } from "@/lib/utils";

/** Answer input: type an outline, or dictate out loud (Web Speech API where available). */
export function AnswerPad({ value, onChange, placeholder, id }: { value: string; onChange: (v: string) => void; placeholder?: string; id: string }) {
  const [mode, setMode] = useState<"type" | "speak">("type");
  const dictation = useDictation((text) => onChange(value ? `${value.replace(/\s+$/, "")} ${text}` : text));

  const switchTo = (m: "type" | "speak") => {
    if (m === "type" && dictation.listening) dictation.stop();
    setMode(m);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">
          Your answer
        </label>
        <div className="flex gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Answer input mode">
          <button role="tab" aria-selected={mode === "type"} onClick={() => switchTo("type")} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium", mode === "type" ? "bg-night text-white" : "text-muted hover:text-ink")}>
            <Keyboard className="h-3.5 w-3.5" /> Type
          </button>
          <Tooltip content={dictation.supported ? "Dictation uses your browser's speech service." : "Voice dictation isn't supported in this browser (try Chrome, Edge or Safari)."}>
            <button
              role="tab"
              aria-selected={mode === "speak"}
              disabled={!dictation.supported}
              onClick={() => switchTo("speak")}
              className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium disabled:opacity-40", mode === "speak" ? "bg-night text-white" : "text-muted hover:text-ink")}
            >
              <Mic className="h-3.5 w-3.5" /> Speak
            </button>
          </Tooltip>
        </div>
      </div>

      {mode === "speak" && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
          <button
            onClick={dictation.listening ? dictation.stop : dictation.start}
            aria-pressed={dictation.listening}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-95",
              dictation.listening ? "animate-pulse-dot bg-bad" : "bg-[linear-gradient(135deg,#2657eb,#4338ca)]",
            )}
            aria-label={dictation.listening ? "Stop dictation" : "Start dictation"}
          >
            {dictation.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1 text-[13px]">
            {dictation.error ? (
              <span className="text-bad">{dictation.error}</span>
            ) : dictation.listening ? (
              <span className="text-ink-2">{dictation.interim || "Listening… answer as you would in the interview."}</span>
            ) : (
              <span className="text-muted">Tap the mic and answer out loud. Your words appear below.</span>
            )}
          </div>
        </div>
      )}

      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={placeholder ?? "Structure your answer: context → approach → trade-offs → result. Bullet points are fine."}
        className="w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-accent-400 focus:ring-4 focus:ring-accent-100"
      />
      <div className="mt-1 text-right text-[11.5px] tabular-nums text-faint">{value.trim() ? `${value.trim().split(/\s+/).length} words` : ""}</div>
    </div>
  );
}
