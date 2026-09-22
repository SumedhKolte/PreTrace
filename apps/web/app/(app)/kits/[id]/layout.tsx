"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { GenerationTimeline } from "@/components/kit/generation-timeline";
import { KitHeader } from "@/components/kit/kit-header";
import { KitProvider } from "@/components/kit/kit-context";
import { ErrorState, PageSkeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useGenerationStatus, useKit } from "@/lib/hooks";

export default function KitLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { data, error, isLoading, mutate } = useKit(id);
  const kit = data?.kit;
  const generating = kit?.status === "generating";
  const needsTimeline = generating || (kit?.status === "failed" && !kit.role.title);
  const gen = useGenerationStatus(id, !!generating);
  const [retrying, setRetrying] = useState(false);

  // When the background job finishes, load the finished kit.
  const jobStatus = gen.data?.status?.status;
  useEffect(() => {
    if (generating && jobStatus && ["completed", "partial", "failed"].includes(jobStatus)) void mutate();
  }, [generating, jobStatus, mutate]);

  async function retry() {
    setRetrying(true);
    try {
      await api(`/kits/${id}/generate`, { method: "POST" });
      await mutate();
      await gen.mutate();
    } catch (e) {
      toast.error("Couldn't restart generation", e instanceof ApiError ? e.message : undefined);
    } finally {
      setRetrying(false);
    }
  }

  if (isLoading) return <PageSkeleton />;
  if (error || !kit) {
    return <ErrorState title={error?.status === 404 ? "Kit not found" : "Couldn't load this kit"} message={error?.status === 404 ? "It may have been deleted, or it belongs to another account." : error?.message} onRetry={error?.status === 404 ? undefined : () => mutate()} />;
  }

  if (needsTimeline) {
    return (
      <div className="space-y-6">
        <div>
          <div className="text-[13px] text-muted">New interview kit</div>
          <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.025em]">{generating ? "Generating…" : "Generation failed"}</h1>
        </div>
        <GenerationTimeline status={gen.data?.status} companyUrl={kit.input.companyUrl} onRetry={retry} retrying={retrying} />
      </div>
    );
  }

  return (
    <KitProvider kit={kit} mutate={mutate}>
      <div className="space-y-6">
        <KitHeader />
        <div key={id} className="animate-fade-in">
          {children}
        </div>
      </div>
    </KitProvider>
  );
}
