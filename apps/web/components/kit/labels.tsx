import { Blocks, Building2, Code2, MessagesSquare, type LucideIcon } from "lucide-react";
import type { ItemState, QuestionCategory, SourceType, WeaknessReason } from "@preptrace/shared";
import type { Tone } from "@/components/ui/badge";

export const CATEGORY_META: Record<QuestionCategory, { label: string; icon: LucideIcon; dot: string; soft: string }> = {
  technical: { label: "Technical", icon: Code2, dot: "bg-accent-500", soft: "bg-accent-50 text-accent-700" },
  behavioural: { label: "Behavioural", icon: MessagesSquare, dot: "bg-[#e0a023]", soft: "bg-warn-soft text-warn" },
  system_design: { label: "System Design", icon: Blocks, dot: "bg-[#0e9384]", soft: "bg-[#ecfdf9] text-[#0e7a6e]" },
  company_fit: { label: "Company Fit", icon: Building2, dot: "bg-[#d4488e]", soft: "bg-[#fdf2f8] text-[#b0336f]" },
};

export const STATE_TONE: Record<ItemState, Tone> = {
  generated: "outline",
  edited: "accent",
  pinned: "dark",
  manual: "good",
  deleted: "bad",
};

export const STATE_LABEL: Record<ItemState, string> = {
  generated: "Generated",
  edited: "Edited",
  pinned: "Pinned",
  manual: "Manual",
  deleted: "Deleted",
};

export const SOURCE_TYPE: Record<SourceType, { label: string; tone: Tone }> = {
  official: { label: "Official", tone: "neutral" },
  hiring: { label: "Hiring", tone: "accent" },
  engineering: { label: "Engineering", tone: "good" },
  about: { label: "About", tone: "neutral" },
  public_discussion: { label: "Public discussion", tone: "warn" },
};

export const REASON_LABEL: Record<WeaknessReason, string> = {
  must_have: "Must-have requirement",
  low_confidence: "Low confidence",
  high_difficulty: "High difficulty",
  never_practiced: "Not practised yet",
  insufficient_practice: "Insufficient practice",
  stale: "Not practised recently",
  uncovered: "No questions cover it",
};

export const DIFFICULTY_LABEL = { 1: "Fundamentals", 2: "Applied", 3: "Advanced" } as const;

export function DifficultyDots({ value }: { value: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Difficulty ${value} of 3`} title={`Difficulty ${value}/3 · ${DIFFICULTY_LABEL[value]}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= value ? "bg-ink-2" : "bg-line-strong"}`} />
      ))}
    </span>
  );
}
