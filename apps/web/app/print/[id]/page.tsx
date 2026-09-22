"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { CATEGORY_LABELS } from "@preptrace/shared";
import { Wordmark } from "@/components/brand";
import { Button, buttonClass } from "@/components/ui/button";
import { ErrorState, PageSkeleton } from "@/components/ui/states";
import { useKit, useReadiness } from "@/lib/hooks";
import { minutesLabel } from "@/lib/utils";

/** One-page printable prep sheet: company, role, top requirements & questions, weak spots, schedule. */
export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useKit(id);
  const readiness = useReadiness(id).data?.readiness;
  if (isLoading) return <div className="p-8"><PageSkeleton /></div>;
  if (error || !data) return <div className="p-8"><ErrorState message={error?.message ?? "Kit not found"} /></div>;
  const kit = data.kit;
  const must = kit.role.requirements.filter((r) => r.priority === "must");
  const top = kit.questions.filter((q) => !q.meta.deleted).sort((a, b) => b.difficulty - a.difficulty || a.order - b.order).slice(0, 10);

  return (
    <div className="mx-auto max-w-[820px] bg-white px-8 py-8 text-[12.5px] leading-relaxed text-ink print:px-0 print:py-0">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href={`/kits/${kit.id}`} className={buttonClass("ghost", "sm")}>
          <ArrowLeft className="h-4 w-4" /> Back to kit
        </Link>
        <Button variant="dark" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <header className="flex items-start justify-between border-b border-line pb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted">Interview prep sheet</div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">{kit.role.title}</h1>
          <div className="text-muted">
            {kit.source.company} · {kit.role.seniority} · {kit.role.location}
          </div>
        </div>
        <Wordmark />
      </header>

      <section className="mt-5 grid grid-cols-3 gap-5">
        <div className="col-span-2">
          <h2 className="text-[13px] font-semibold">Company</h2>
          <p className="mt-1">{kit.companyBrief.summary}</p>
          {kit.companyBrief.hiring_process.found && (
            <p className="mt-2">
              <span className="font-medium">Process:</span> {kit.companyBrief.hiring_process.stages.map((s) => s.name).join(" → ")}
            </p>
          )}
        </div>
        <div>
          <h2 className="text-[13px] font-semibold">Readiness</h2>
          <div className="mt-1 text-[26px] font-semibold">{readiness?.overall ?? 0}%</div>
          <div className="text-muted">Weak spots: {readiness?.weakSpots.map((w) => w.topic).join(", ") || "none"}</div>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="text-[13px] font-semibold">Must-have requirements</h2>
        <ul className="mt-1 grid grid-cols-2 gap-x-6">
          {must.map((r) => (
            <li key={r.id}>
              <span className="font-mono text-muted">{r.id}</span> {r.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-5">
        <h2 className="text-[13px] font-semibold">Top questions</h2>
        <ol className="mt-1 space-y-2">
          {top.map((q, i) => (
            <li key={q.id} className="break-inside-avoid">
              <div className="font-medium">
                {i + 1}. {q.prompt} <span className="font-normal text-muted">({CATEGORY_LABELS[q.category]}, {q.difficulty}/3)</span>
              </div>
              <div className="whitespace-pre-line pl-4 text-ink-2">{q.answer_outline}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-5 break-inside-avoid">
        <h2 className="text-[13px] font-semibold">{kit.schedule.days.length}-day schedule</h2>
        <table className="mt-1 w-full">
          <tbody>
            {kit.schedule.days.slice(0, 14).map((d) => (
              <tr key={d.day} className="border-b border-line">
                <td className="w-14 py-1 font-medium">Day {d.day}</td>
                <td className="py-1">{d.focus}</td>
                <td className="py-1 text-right text-muted">
                  {d.question_ids.length} q · {minutesLabel(d.minutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {kit.schedule.days.length > 14 && <p className="mt-1 text-muted">…and {kit.schedule.days.length - 14} more days in the app.</p>}
      </section>
    </div>
  );
}
