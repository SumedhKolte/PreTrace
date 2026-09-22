"use client";

import { useState } from "react";
import { Lock, Pin, ShieldCheck, Sparkles, UserPen } from "lucide-react";
import { isProtected, type QuestionCategory, type RegenerateScope } from "@preptrace/shared";
import { ConfirmDialog } from "@/components/ui/overlay";
import { SCOPE_LABELS, useKitCtx } from "./kit-context";

/**
 * Explains exactly what a scoped regeneration will keep and replace before it runs.
 * Nothing the user touched is ever replaced (except schedule days, and only when
 * they explicitly opt in).
 */
export function RegenerateDialog({ scope, onClose }: { scope: RegenerateScope | null; onClose: () => void }) {
  const { kit, regenerate } = useKitCtx();
  const [replaceEdited, setReplaceEdited] = useState(false);
  if (!scope) return null;

  const category = ["technical", "behavioural", "system_design", "company_fit"].includes(scope) ? (scope as QuestionCategory) : null;
  const inCat = category ? kit.questions.filter((q) => q.category === category && !q.meta.deleted) : [];
  const kept = inCat.filter((q) => isProtected(q.meta));
  const replaced = inCat.length - kept.length;
  const cards = kit.flashcards.filter((f) => !f.meta.deleted);
  const keptCards = cards.filter((f) => isProtected(f.meta)).length;
  const lockedDays = kit.schedule.days.filter((d) => d.locked).length;

  const rows: { icon: React.ReactNode; text: string }[] = [];
  if (category) {
    rows.push({ icon: <ShieldCheck className="h-4 w-4 text-good" />, text: `${kept.length} edited, pinned or manual question${kept.length === 1 ? "" : "s"} will be kept exactly as they are.` });
    rows.push({ icon: <Sparkles className="h-4 w-4 text-accent-600" />, text: `${replaced} untouched generated question${replaced === 1 ? "" : "s"} will be replaced with fresh ones.` });
    rows.push({ icon: <Lock className="h-4 w-4 text-muted" />, text: "Other categories, flashcards and the company brief are not touched. Coverage is re-checked." });
    rows.push({ icon: <Pin className="h-4 w-4 text-muted" />, text: lockedDays ? `The schedule is updated around your ${lockedDays} edited day(s), which stay as they are.` : "The schedule is updated to include the new questions." });
  } else if (scope === "company") {
    rows.push({ icon: <Sparkles className="h-4 w-4 text-accent-600" />, text: "The company site is re-crawled and a fresh brief is written from verified facts." });
    rows.push({ icon: <UserPen className="h-4 w-4 text-good" />, text: kit.companyBrief.edited ? "Your edited brief is saved to history — you can restore it at any time." : "The current brief is saved to history so you can restore it." });
    rows.push({ icon: <Lock className="h-4 w-4 text-muted" />, text: "Questions, flashcards and your schedule are not modified." });
  } else if (scope === "flashcards") {
    rows.push({ icon: <ShieldCheck className="h-4 w-4 text-good" />, text: `${keptCards} edited, pinned or manual card(s) will be kept.` });
    rows.push({ icon: <Sparkles className="h-4 w-4 text-accent-600" />, text: `${cards.length - keptCards} untouched generated card(s) will be replaced.` });
  } else if (scope === "schedule") {
    rows.push({ icon: <Sparkles className="h-4 w-4 text-accent-600" />, text: "Days are re-allocated deterministically: hard, must-have material first." });
    rows.push({ icon: <Lock className="h-4 w-4 text-muted" />, text: lockedDays ? `${lockedDays} day(s) you edited are locked and kept.` : "No days have been edited." });
  }

  return (
    <ConfirmDialog
      open={!!scope}
      onOpenChange={(o) => {
        if (!o) {
          setReplaceEdited(false);
          onClose();
        }
      }}
      title={`Regenerate ${SCOPE_LABELS[scope].toLowerCase()}?`}
      description="Regeneration is scoped and non-destructive."
      confirmLabel="Regenerate"
      tone={replaceEdited ? "danger" : "primary"}
      onConfirm={async () => {
        await regenerate(scope, scope === "schedule" ? { replaceEdited } : undefined);
        setReplaceEdited(false);
        onClose();
      }}
    >
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-ink-2">
            <span className="mt-0.5 shrink-0">{r.icon}</span>
            {r.text}
          </li>
        ))}
      </ul>
      {scope === "schedule" && lockedDays > 0 && (
        <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-[#f4d1cc] bg-bad-soft/60 p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-bad)]" checked={replaceEdited} onChange={(e) => setReplaceEdited(e.target.checked)} />
          <span>
            <span className="font-medium text-bad">Also replace my edited days.</span> This discards your manual schedule changes.
          </span>
        </label>
      )}
    </ConfirmDialog>
  );
}
