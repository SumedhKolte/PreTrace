import Link from "next/link";
import { ArrowRight, Binoculars, CalendarRange, FileSearch, Gauge, ListChecks, ShieldCheck, Sparkles, Target } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { buttonClass } from "@/components/ui/button";

const steps = [
  { icon: FileSearch, title: "Understand the role", body: "Requirements are extracted from your JD and grounded in its exact wording — nothing invented." },
  { icon: Binoculars, title: "Research the company", body: "A robots-aware crawler finds about, engineering and hiring pages by following links, not guessing URLs." },
  { icon: ListChecks, title: "Build & check coverage", body: "Questions are generated per category, then a deterministic check guarantees every must-have is covered." },
  { icon: CalendarRange, title: "Plan exactly N days", body: "A deterministic scheduler front-loads hard, high-priority material across the days you have." },
  { icon: Target, title: "Practice & repair", body: "Confidence tracking powers a Weak-Spot Coach that targets your weakest requirements." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("ghost", "md")}>
            Sign in
          </Link>
          <Link href="/register" className={buttonClass("dark", "md")}>
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="grid-bg relative mx-auto max-w-6xl px-5 pb-16 pt-14 md:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 shadow-card">
              <Sparkles className="h-3.5 w-3.5 text-accent-600" /> Research-grounded interview prep
            </span>
            <h1 className="text-balance mt-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink md:text-[60px]">
              Turn a job description into your personal interview plan.
            </h1>
            <p className="text-balance mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-muted">
              Paste the JD, add the company website and the days you have. Get a traceable kit — role breakdown, researched company brief, questions,
              flashcards and a day-by-day schedule — then practise until your weak spots aren&apos;t.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/register" className={buttonClass("primary", "lg")}>
                Create your first kit <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/login" className={buttonClass("secondary", "lg")}>
                I have an account
              </Link>
            </div>
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {steps.map((s, i) => (
              <div key={s.title} className="card relative p-4 animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex items-center justify-between">
                  <s.icon className="h-5 w-5 text-accent-600" />
                  <span className="font-mono text-[11px] text-faint">0{i + 1}</span>
                </div>
                <div className="mt-3 text-[14px] font-semibold tracking-[-0.01em]">{s.title}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-20 md:grid-cols-3">
          {[
            { icon: Gauge, title: "Deterministic where it matters", body: "Coverage, scheduling and weakness scoring are plain code you can audit. The model only does language work." },
            { icon: ShieldCheck, title: "Honest by design", body: "Every fact links to a source. Thin JDs give thin kits. Missing hiring pages are reported, never imagined." },
            { icon: Target, title: "Your edits are safe", body: "Edit, pin, reorder and add questions. Regenerating a section never overwrites your work." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-night-line bg-night p-6 text-white">
              <f.icon className="h-5 w-5 text-accent-300" />
              <div className="mt-4 text-[15px] font-semibold">{f.title}</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/60">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
