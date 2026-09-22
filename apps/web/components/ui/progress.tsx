import { cn, readinessTone } from "@/lib/utils";

const toneBar = { good: "bg-good", warn: "bg-[#e0a023]", bad: "bg-bad" } as const;
const toneStroke = { good: "#16a34a", warn: "#e0a023", bad: "#dc4a3d" } as const;

export function ProgressBar({
  value,
  tone,
  className,
  label,
  size = "md",
}: {
  value: number;
  tone?: "accent" | "good" | "warn" | "bad" | "auto" | "dark";
  className?: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const v = Math.max(0, Math.min(100, value));
  const t = tone === "auto" ? readinessTone(v) : tone;
  const color = t === "good" || t === "warn" || t === "bad" ? toneBar[t] : t === "dark" ? "bg-night" : "bg-accent-500";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("w-full overflow-hidden rounded-full bg-sunken", size === "sm" ? "h-1.5" : "h-2", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Circular readiness indicator. */
export function ReadinessRing({
  value,
  size = 64,
  stroke = 6,
  label,
  dark,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  dark?: boolean;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = toneStroke[readinessTone(v)];
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Readiness"} ${Math.round(v)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? "rgba(255,255,255,0.1)" : "var(--color-sunken)"} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.2,0.7,0.2,1)" }}
        />
      </svg>
      <span className={cn("absolute font-semibold tabular-nums tracking-[-0.02em]", dark ? "text-white" : "text-ink")} style={{ fontSize: size * 0.26 }}>
        {Math.round(v)}
        <span style={{ fontSize: size * 0.14 }} className={dark ? "text-white/50" : "text-muted"}>
          %
        </span>
      </span>
    </div>
  );
}

export function Meter({ value, max = 5, className }: { value: number | null; max?: number; className?: string }) {
  return (
    <div className={cn("flex gap-0.5", className)} aria-label={value === null ? "Not rated" : `${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn("h-1.5 w-3 rounded-full", value !== null && i < Math.round(value) ? "bg-accent-500" : "bg-sunken")} />
      ))}
    </div>
  );
}
