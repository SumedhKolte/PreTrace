"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 3D flip card. Keyboard accessible (Enter/Space) and respects reduced motion. */
export function FlipCard({
  front,
  back,
  flipped,
  onFlip,
  className,
  frontLabel = "Question",
  backLabel = "Answer",
  footer,
}: {
  front: ReactNode;
  back: ReactNode;
  flipped: boolean;
  onFlip?: () => void;
  className?: string;
  frontLabel?: string;
  backLabel?: string;
  footer?: ReactNode;
}) {
  return (
    <div className={cn("flip-card", className)}>
      <div
        role={onFlip ? "button" : undefined}
        tabIndex={onFlip ? 0 : undefined}
        aria-pressed={onFlip ? flipped : undefined}
        aria-label={onFlip ? (flipped ? "Show front" : "Reveal answer") : undefined}
        onClick={onFlip}
        onKeyDown={(e) => {
          if (onFlip && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onFlip();
          }
        }}
        className={cn("flip-inner relative grid h-full min-h-[inherit] w-full outline-none [&>*]:[grid-area:1/1]", flipped && "is-flipped", onFlip && "cursor-pointer")}
      >
        <div className="flip-face card flex flex-col p-5" aria-hidden={flipped}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{frontLabel}</div>
          <div className="flex flex-1 items-center py-4 text-[15px] font-medium leading-snug">{front}</div>
          {footer}
        </div>
        <div className="flip-face flip-back flex flex-col rounded-2xl border border-night-line bg-night p-5 text-white" aria-hidden={!flipped}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">{backLabel}</div>
          <div className="flex-1 overflow-y-auto whitespace-pre-line py-4 text-[13.5px] leading-relaxed text-white/85">{back}</div>
        </div>
      </div>
    </div>
  );
}
