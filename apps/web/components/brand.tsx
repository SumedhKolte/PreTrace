import { cn } from "@/lib/utils";

/** Brand mark: a trace line passing through checkpoints — JD → research → practice. */
export function LogoMark({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-lg", dark ? "bg-white text-night" : "bg-night text-white", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <path d="M3 17c3.5 0 4-10 8-10s3.5 10 7 10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="3.5" cy="17" r="1.8" fill="currentColor" />
        <circle cx="11" cy="7" r="1.8" fill="#8580fb" />
        <circle cx="20.5" cy="17" r="1.8" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Wordmark({ dark, className }: { dark?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark dark={dark} />
      <span className="leading-none">
        <span className={cn("block text-[14px] font-semibold tracking-[-0.01em]", dark ? "text-white" : "text-ink")}>AI Interview Prep</span>
        <span className={cn("mt-0.5 block text-[11px] font-medium", dark ? "text-white/50" : "text-muted")}>PrepTrace</span>
      </span>
    </span>
  );
}
