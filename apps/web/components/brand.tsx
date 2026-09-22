import Image from "next/image";
import { cn } from "@/lib/utils";

/** Brand mark: PrepTrace road to star mark */
export function LogoMark({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-night ring-1 ring-night/10 shadow-sm",
        dark && "ring-white/20",
        className
      )}
      aria-hidden
    >
      <Image
        src="/logo.png"
        alt="PrepTrace logo"
        width={32}
        height={32}
        className="h-full w-full object-cover"
        priority
      />
    </span>
  );
}

export function Wordmark({ dark, className }: { dark?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark dark={dark} />
      <span className="leading-tight">
        <span className={cn("block text-[15px] font-bold tracking-tight", dark ? "text-white" : "text-ink")}>
          PrepTrace
        </span>
        <span className={cn("block text-[10.5px] font-semibold tracking-wide uppercase", dark ? "text-accent-300" : "text-accent-600")}>
          AI Interview Prep
        </span>
      </span>
    </span>
  );
}
