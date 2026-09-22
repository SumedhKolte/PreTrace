"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { KeyedMutator } from "swr";
import { CATEGORY_LABELS, type GenerationStatus, type KitWorkspace, type QuestionCategory, type ReadinessReport, type RegenerateScope } from "@preptrace/shared";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useJobWatcher, useReadiness } from "@/lib/hooks";

export const SCOPE_LABELS: Record<RegenerateScope, string> = {
  company: "Company brief",
  technical: `${CATEGORY_LABELS.technical} questions`,
  behavioural: `${CATEGORY_LABELS.behavioural} questions`,
  system_design: `${CATEGORY_LABELS.system_design} questions`,
  company_fit: `${CATEGORY_LABELS.company_fit} questions`,
  flashcards: "Flashcards",
  schedule: "Study schedule",
};

interface KitCtx {
  kit: KitWorkspace;
  mutate: KeyedMutator<{ kit: KitWorkspace }>;
  /** Optimistic local update; the server response later replaces it. */
  patchLocal: (fn: (k: KitWorkspace) => KitWorkspace) => void;
  readiness: ReadinessReport | undefined;
  refreshReadiness: () => void;
  regenerate: (scope: RegenerateScope, opts?: { replaceEdited?: boolean }) => Promise<void>;
  regenerating: { scope: RegenerateScope; status: GenerationStatus | null | undefined } | null;
}

const Ctx = createContext<KitCtx | null>(null);

export function KitProvider({ kit, mutate, children }: { kit: KitWorkspace; mutate: KeyedMutator<{ kit: KitWorkspace }>; children: ReactNode }) {
  const toast = useToast();
  const readiness = useReadiness(kit.id, kit.status === "ready" || kit.status === "partial");
  const [scope, setScope] = useState<RegenerateScope | null>(null);

  const watcher = useJobWatcher(kit.id, async (status) => {
    await mutate();
    readiness.mutate();
    const label = scope ? SCOPE_LABELS[scope] : "Section";
    if (status.status === "failed") toast.error(`${label} regeneration failed`, status.error?.message);
    else toast.success(`${label} regenerated`, status.events.at(-1)?.message);
    setScope(null);
  });

  const patchLocal = useCallback((fn: (k: KitWorkspace) => KitWorkspace) => void mutate((d) => (d ? { kit: fn(d.kit) } : d), { revalidate: false }), [mutate]);

  const regenerate = useCallback(
    async (s: RegenerateScope, opts?: { replaceEdited?: boolean }) => {
      try {
        await api(`/kits/${kit.id}/regenerate/${s}`, { body: opts ?? {} });
        setScope(s);
        watcher.start();
      } catch (e) {
        toast.error("Couldn't start regeneration", e instanceof ApiError ? e.message : undefined);
        throw e;
      }
    },
    [kit.id, toast, watcher],
  );

  const value = useMemo<KitCtx>(
    () => ({
      kit,
      mutate,
      patchLocal,
      readiness: readiness.data?.readiness,
      refreshReadiness: () => void readiness.mutate(),
      regenerate,
      regenerating: scope ? { scope, status: watcher.status } : null,
    }),
    [kit, mutate, patchLocal, readiness, regenerate, scope, watcher.status],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKitCtx() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useKitCtx must be used within KitProvider");
  return c;
}

export function liveQuestions(kit: KitWorkspace, category?: QuestionCategory) {
  return kit.questions.filter((q) => !q.meta.deleted && (!category || q.category === category)).sort((a, b) => a.order - b.order);
}

export function liveFlashcards(kit: KitWorkspace) {
  return kit.flashcards.filter((f) => !f.meta.deleted).sort((a, b) => a.order - b.order);
}
