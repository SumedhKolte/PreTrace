"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { CATEGORY_LABELS, type KitWorkspace, type ReadinessReport, type WorkspaceQuestion } from "@preptrace/shared";
import { Wordmark } from "@/components/brand";
import { Button, buttonClass } from "@/components/ui/button";
import { ErrorState, PageSkeleton } from "@/components/ui/states";
import { useKit, useReadiness } from "@/lib/hooks";
import { daysUntil, pathOf } from "@/lib/utils";

const bullets = (outline: string, n: number) =>
  outline
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, n);

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`break-inside-avoid ${className}`}>
      <h2 className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-accent-700">
        <span className="h-3 w-1 rounded-full bg-brand-gradient" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Interview-Day Cram Sheet — one printable page built only from the kit's own data:
 * verified company facts & tech, official process, must-haves with STAR scaffolds,
 * weak-spot reminders and top questions. Print → "Save as PDF" for a PDF.
 */
export default function CramSheetPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useKit(id);
  const readiness = useReadiness(id).data?.readiness;
  if (isLoading) return <div className="p-8"><PageSkeleton /></div>;
  if (error || !data) return <div className="p-8"><ErrorState message={error?.message ?? "Kit not found"} /></div>;
  return <Sheet kit={data.kit} readiness={readiness} />;
}

function Sheet({ kit, readiness }: { kit: KitWorkspace; readiness?: ReadinessReport }) {
  const live = kit.questions.filter((q) => !q.meta.deleted);
  const must = kit.role.requirements.filter((r) => r.priority === "must");
  const facts = kit.research.signals.filter((s) => s.kind === "company").slice(0, 4);
  const interview = new Date(new Date(kit.createdAt).getTime() + kit.input.days * 86_400_000);
  const left = daysUntil(interview.toISOString());
  const kindOf = new Map(kit.role.requirements.map((r) => [r.id, r.kind]));
  /** Best question for a requirement: matching category first (technical ↔ technical/system design), then fewest other requirements, then hardest. */
  const questionFor = (rid: string): WorkspaceQuestion | undefined => {
    const wantBehavioural = kindOf.get(rid) === "behavioural";
    const fits = (q: WorkspaceQuestion) => (wantBehavioural ? q.category === "behavioural" : q.category === "technical" || q.category === "system_design");
    return live
      .filter((q) => q.requirement_ids.includes(rid))
      .sort((a, b) => Number(fits(b)) - Number(fits(a)) || a.requirement_ids.length - b.requirement_ids.length || b.difficulty - a.difficulty)[0];
  };
  const top = [...live].sort((a, b) => b.difficulty - a.difficulty || a.order - b.order).slice(0, 6);
  const sources = [...new Set([...kit.companyBrief.sources, ...kit.companyBrief.hiring_process.stages.map((s) => s.source_url)])].slice(0, 6);

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-line bg-canvas/90 px-6 py-3 backdrop-blur">
        <Link href={`/kits/${kit.id}`} className={buttonClass("ghost", "sm")}>
          <ArrowLeft className="h-4 w-4" /> Back to kit
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-[12.5px] text-muted sm:inline">Tip: choose “Save as PDF” in the print dialog.</span>
          <Button variant="primary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Print / Save PDF
          </Button>
        </div>
      </div>

      <article className="mx-auto my-6 max-w-[860px] rounded-2xl bg-white p-8 text-[11.5px] leading-relaxed text-ink shadow-raised print:my-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        {/* Header */}
        <header className="night-surface -m-8 mb-6 flex items-start justify-between gap-6 rounded-t-2xl px-8 py-6 text-white print:m-0 print:mb-5 print:rounded-xl">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan">Interview-day cram sheet</div>
            <h1 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{kit.role.title}</h1>
            <p className="mt-1 text-[12.5px] text-white/65">
              {kit.source.company} · {kit.role.seniority !== "unspecified" ? `${kit.role.seniority} · ` : ""}
              {interview.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              {left !== null ? ` (${left === 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`})` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <Wordmark dark />
            {readiness && (
              <div className="text-right">
                <div className="text-[26px] font-semibold leading-none tabular-nums">{readiness.overall}%</div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-white/50">readiness</div>
              </div>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 print:grid-cols-2">
          <Section title="Company talking points">
            <p>{kit.companyBrief.summary}</p>
            {facts.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {facts.map((f) => (
                  <li key={f.id} className="flex gap-1.5">
                    <span className="text-accent-600">▸</span>
                    {f.text}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="How they interview">
            {kit.companyBrief.hiring_process.note && <p className="mb-1 text-[10.5px] italic text-warn">{kit.companyBrief.hiring_process.note}</p>}
            {kit.companyBrief.hiring_process.found ? (
              <ol className="space-y-1">
                {kit.companyBrief.hiring_process.stages.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-night text-[9px] font-semibold text-white">{i + 1}</span>
                    <span>
                      <span className="font-semibold">{s.name}</span>
                      {s.description ? ` — ${s.description}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted">No official hiring process was published — prepare for the JD&apos;s requirements.</p>
            )}
            {kit.research.techStack.length > 0 && (
              <p className="mt-2">
                <span className="font-semibold">Their stack: </span>
                {kit.research.techStack.slice(0, 10).map((t, i) => (
                  <span key={t.name}>
                    {i > 0 && ", "}
                    <span className={t.inJd ? "font-semibold text-accent-700" : ""}>{t.name}</span>
                  </span>
                ))}
              </p>
            )}
          </Section>

          <Section title="Must-haves → your stories" className="sm:col-span-2 print:col-span-2">
            <table className="w-full border-collapse">
              <tbody>
                {must.map((r) => {
                  const q = questionFor(r.id);
                  return (
                    <tr key={r.id} className="border-b border-line align-top last:border-0">
                      <td className="w-[38%] py-1.5 pr-3">
                        <span className="font-mono text-[10px] text-faint">{r.id}</span> <span className="font-semibold">{r.topic}</span>
                        <div className="text-[10.5px] text-muted">{r.text}</div>
                      </td>
                      <td className="py-1.5">
                        {r.kind === "behavioural" ? (
                          <div className="grid grid-cols-4 gap-1 text-[10px] text-muted">
                            {["Situation", "Task", "Action", "Result"].map((s) => (
                              <div key={s} className="h-8 rounded border border-dashed border-line-strong px-1 pt-0.5">
                                {s}
                              </div>
                            ))}
                          </div>
                        ) : q ? (
                          <>
                            <div className="italic">“{q.prompt}”</div>
                            <div className="text-[10.5px] text-muted">{bullets(q.answer_outline, 2).join(" · ")}</div>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <Section title="Weak-spot reminders">
            {readiness && readiness.weakSpots.length > 0 ? (
              <ul className="space-y-1.5">
                {readiness.weakSpots.slice(0, 4).map((w) => {
                  const q = questionFor(w.requirementId);
                  return (
                    <li key={w.requirementId}>
                      <span className="font-semibold">{w.topic}</span> <span className="text-muted">· {w.readiness}% ready</span>
                      {q && <div className="text-[10.5px] text-ink-2">Remember: {bullets(q.answer_outline, 2).join("; ")}</div>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted">No weak spots right now — keep practising to keep it that way.</p>
            )}
          </Section>

          <Section title="Likely hardest questions">
            <ol className="space-y-1">
              {top.map((q, i) => (
                <li key={q.id}>
                  <span className="font-semibold">{i + 1}.</span> {q.prompt} <span className="text-[10px] text-faint">({CATEGORY_LABELS[q.category]})</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <footer className="mt-6 border-t border-line pt-2 text-[9.5px] text-faint">
          Built by PrepTrace from your job description and the company&apos;s own pages{sources.length ? `: ${sources.map(pathOf).join(" · ")}` : "."}
        </footer>
      </article>
    </div>
  );
}
