"use client";

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { ReadinessRing } from "@/components/ui/progress";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/states";
import { useKits } from "@/lib/hooks";
import { daysUntil } from "@/lib/utils";

/** Kit chooser used by the global Practice and Weak Spots entries in the sidebar. */
export function KitPicker({ title, description, suffix, icon, cta }: { title: string; description: string; suffix: string; icon: ReactNode; cta: string }) {
  const { data, error, isLoading, mutate } = useKits();
  const kits = (data?.kits ?? []).filter((k) => k.status === "ready" || k.status === "partial");
  const sorted = [...kits].sort((a, b) => a.readiness - b.readiness);
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => mutate()} />
      ) : kits.length === 0 ? (
        <EmptyState icon={icon} title="No kits ready yet" description="Create a kit first — practice and weak spots appear once it's generated." action={<ButtonLink href="/kits/new" variant="primary" icon={<Plus className="h-4 w-4" />}>Create Interview Kit</ButtonLink>} />
      ) : (
        <div className="space-y-2.5">
          {sorted.map((k, i) => (
            <Link
              key={k.id}
              href={`/kits/${k.id}/${suffix}`}
              className="card group flex animate-rise items-center gap-4 p-4 transition-shadow hover:shadow-raised"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <ReadinessRing value={k.readiness} size={52} stroke={5} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">{k.role}</div>
                <div className="text-[13px] text-muted">
                  {k.company} · interview in {daysUntil(k.interviewDate)} days · {k.weakSpotCount} weak spots
                </div>
              </div>
              <span className="hidden items-center gap-1 text-[13px] font-medium text-ink group-hover:text-accent-700 sm:flex">
                {cta} <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
