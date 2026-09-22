import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "dark" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-2 border-line",
  accent: "bg-accent-50 text-accent-700 border-accent-100",
  good: "bg-good-soft text-good border-[#c9f0d6]",
  warn: "bg-warn-soft text-warn border-[#fbe3b8]",
  bad: "bg-bad-soft text-bad border-[#f9d3cf]",
  dark: "bg-night text-white border-night",
  outline: "bg-transparent text-muted border-line",
};

export function Badge({ tone = "neutral", children, className, icon, title }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[11.5px] font-medium leading-none tracking-[0.005em]",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1 font-mono text-[11px] text-muted shadow-[0_1px_0_var(--color-line)]">
      {children}
    </kbd>
  );
}

export function IdTag({ children }: { children: ReactNode }) {
  return <span className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted">{children}</span>;
}
