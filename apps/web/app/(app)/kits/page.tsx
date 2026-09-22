"use client";

import { useMemo, useState } from "react";
import { FolderKanban, Plus, Search } from "lucide-react";
import { KitCard } from "@/components/kit/kit-card";
import { ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/states";
import { useKits } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const FILTERS = ["all", "ready", "generating", "failed"] as const;

export default function KitsPage() {
  const { data, error, isLoading, mutate } = useKits();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const kits = useMemo(
    () =>
      (data?.kits ?? []).filter(
        (k) =>
          (filter === "all" || (filter === "ready" ? k.status === "ready" || k.status === "partial" : k.status === filter)) &&
          `${k.role} ${k.company}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [data, q, filter],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="My Kits" description="Every role you're preparing for." actions={<ButtonLink href="/kits/new" variant="primary" icon={<Plus className="h-4 w-4" />}>New kit</ButtonLink>} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search roles or companies" className="pl-9" aria-label="Search kits" />
        </div>
        <div className="flex gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Filter kits">
          {FILTERS.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn("h-7 rounded-lg px-3 text-[13px] font-medium capitalize", filter === f ? "bg-night text-white" : "text-muted hover:text-ink")}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => mutate()} />
      ) : kits.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title={data?.kits.length ? "No kits match" : "Your next interview starts here."}
          description={data?.kits.length ? "Try a different search or filter." : "Create a kit from a job description to get started."}
          action={!data?.kits.length && <ButtonLink href="/kits/new" variant="primary">Create Interview Kit</ButtonLink>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{kits.map((k, i) => <KitCard key={k.id} kit={k} index={i} />)}</div>
      )}
    </div>
  );
}
