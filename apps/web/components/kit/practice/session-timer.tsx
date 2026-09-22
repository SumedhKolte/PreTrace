"use client";

import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

/** Two short beeps via WebAudio — no audio asset needed. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.22].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* audio unavailable — visual warning still shows */
  }
}

/**
 * Interview-pressure countdown for one card. Mount with a `key` per card to reset.
 * Amber pulse in the final minute, red at zero, optional chime.
 */
export function SessionTimer({ seconds, running, sound }: { seconds: number; running: boolean; sound: boolean }) {
  const [left, setLeft] = useState(seconds);
  const chimed = useRef(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (left === 0 && sound && !chimed.current) {
      chimed.current = true;
      chime();
    }
  }, [left, sound]);

  const warn = left > 0 && left <= 60;
  const over = left === 0;
  const pct = (left / seconds) * 100;
  return (
    <div className="flex items-center gap-2" role="timer" aria-live={warn || over ? "polite" : "off"} aria-label={over ? "Time's up" : `${Math.ceil(left / 60)} minutes left`}>
      <div className="hidden h-1 w-20 overflow-hidden rounded-full bg-sunken sm:block" aria-hidden>
        <div className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", over ? "bg-bad" : warn ? "bg-[#e0a023]" : "bg-accent-500")} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[12px] font-medium tabular-nums",
          over ? "bg-bad-soft text-bad" : warn ? "animate-timer-warn bg-warn-soft text-warn" : "bg-subtle text-ink-2",
        )}
      >
        <Timer className="h-3 w-3" />
        {over ? "Time's up" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
      </span>
    </div>
  );
}
