import { Cpu, Link2 } from "lucide-react";
import type { CompanyTech, TechCategory } from "@preptrace/shared";
import { Tooltip } from "@/components/ui/overlay";
import { cn, pathOf } from "@/lib/utils";

const CATEGORY_LABEL: Record<TechCategory, string> = {
  language: "Languages",
  framework: "Frameworks",
  datastore: "Data stores",
  messaging: "Streaming & data",
  infrastructure: "Infrastructure",
  practice: "Engineering practices",
};

function Chip({ t }: { t: CompanyTech }) {
  return (
    <Tooltip
      content={
        <span>
          Mentioned {t.mentions}× on {t.sources.map(pathOf).join(", ")}
          {t.inJd ? " · also in your job description" : ""}
        </span>
      }
    >
      <span
        tabIndex={0}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium",
          t.inJd ? "border-accent-200 bg-accent-50 text-accent-800" : "border-line bg-surface text-ink-2",
        )}
      >
        {t.inJd && <Link2 className="h-3 w-3" aria-label="Also in the job description" />}
        {t.name}
        <span className="text-[11px] tabular-nums text-faint">{t.mentions}</span>
      </span>
    </Tooltip>
  );
}

/**
 * Company DNA: technologies the company itself writes about, found by deterministic
 * dictionary matching on the crawled pages (never inferred by the AI).
 */
export function CompanyDna({ techs, compact }: { techs: CompanyTech[]; compact?: boolean }) {
  if (techs.length === 0) {
    return <p className="text-[13px] text-muted">No specific technologies were mentioned on the company pages we could read.</p>;
  }
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {techs.slice(0, 8).map((t) => (
          <Chip key={t.name} t={t} />
        ))}
      </div>
    );
  }
  const groups = (Object.keys(CATEGORY_LABEL) as TechCategory[]).map((c) => [c, techs.filter((t) => t.category === c)] as const).filter(([, xs]) => xs.length);
  const overlap = techs.filter((t) => t.inJd).length;
  return (
    <div className="space-y-4">
      {overlap > 0 && (
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          <Cpu className="h-4 w-4 text-accent-600" />
          {overlap} of these also appear in your job description — expect scenarios built on them.
        </p>
      )}
      {groups.map(([c, xs]) => (
        <div key={c}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{CATEGORY_LABEL[c]}</div>
          <div className="flex flex-wrap gap-1.5">
            {xs.map((t) => (
              <Chip key={t.name} t={t} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
