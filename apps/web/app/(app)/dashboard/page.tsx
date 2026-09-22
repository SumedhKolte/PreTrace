"use client";

import Link from "next/link";
import { ArrowRight, Flame, FolderKanban, Gauge, Plus, Sparkles, Target } from "lucide-react";
import { KitCard } from "@/components/kit/kit-card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { ReadinessRing } from "@/components/ui/progress";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/states";
import { useKits, useMe } from "@/lib/hooks";
import { daysUntil, greeting } from "@/lib/utils";

export default function DashboardPage() {
  const me = useMe();
  const { data, error, isLoading, mutate } = useKits();
  const kits = data?.kits ?? [];
  const active = kits.filter((k) => k.status === "ready" || k.status === "partial");
  const next = [...active].sort((a, b) => (daysUntil(a.interviewDate) ?? 99) - (daysUntil(b.interviewDate) ?? 99))[0];
  const avgReadiness = active.length ? Math.round(active.reduce((s, k) => s + k.readiness, 0) / active.length) : 0;
  const weakTotal = active.reduce((s, k) => s + k.weakSpotCount, 0);
  const firstName = me.data?.user.name.split(" ")[0];

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        description="Prepare smarter for your next interview."
        actions={
          <ButtonLink href="/kits/new" variant="primary" icon={<Plus className="h-4 w-4" />}>
            Create Interview Kit
          </ButtonLink>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-44 md:col-span-2" />
          <Skeleton className="h-44" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => mutate()} />
      ) : kits.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title="Your next interview starts here."
          description="Paste a job description and company website. We'll research the company, build your question bank and plan every day until the interview."
          action={
            <ButtonLink href="/kits/new" variant="primary" icon={<Plus className="h-4 w-4" />}>
              Create Interview Kit
            </ButtonLink>
          }
          className="py-20"
        />
      ) : (
        <>
          {/* Hero: next interview + readiness */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="relative overflow-hidden rounded-2xl border border-night-line bg-night p-6 text-white lg:col-span-2">
              <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent-500/25 blur-3xl" />
              {next ? (
                <div className="relative flex h-full flex-col justify-between gap-6 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/50">Next interview</div>
                    <h2 className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{next.role}</h2>
                    <p className="mt-1 text-[14px] text-white/60">
                      {next.company} · {daysUntil(next.interviewDate) === 0 ? "today" : `in ${daysUntil(next.interviewDate)} days`}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Link href={`/kits/${next.id}/practice`} className={buttonClass("primary", "md")}>
                        <Target className="h-4 w-4" /> Practice now
                      </Link>
                      <Link href={`/kits/${next.id}/weak-spots`} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/15 bg-white/5 px-3.5 text-sm font-medium text-white hover:bg-white/10">
                        <Gauge className="h-4 w-4" /> Weak spots {next.weakSpotCount > 0 && <span className="text-white/60">· {next.weakSpotCount}</span>}
                      </Link>
                    </div>
                  </div>
                  <ReadinessRing value={next.readiness} size={112} stroke={9} dark label="Readiness" />
                </div>
              ) : (
                <div className="relative text-white/70">Your kits are still generating — this page updates live.</div>
              )}
            </div>
            <div className="card grid grid-cols-2 gap-px overflow-hidden bg-line p-0">
              {[
                { icon: FolderKanban, label: "Active kits", value: active.length },
                { icon: Gauge, label: "Avg readiness", value: `${avgReadiness}%` },
                { icon: Flame, label: "Weak spots", value: weakTotal },
                { icon: Target, label: "Generating", value: kits.filter((k) => k.status === "generating").length },
              ].map((s) => (
                <div key={s.label} className="bg-surface p-4">
                  <s.icon className="h-4 w-4 text-muted" />
                  <div className="mt-3 text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{s.value}</div>
                  <div className="text-[12px] text-muted">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
                Your kits <Badge>{kits.length}</Badge>
              </h2>
              <Link href="/kits" className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {kits.slice(0, 6).map((k, i) => (
                <KitCard key={k.id} kit={k} index={i} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
