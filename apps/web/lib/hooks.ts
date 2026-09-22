"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { GenerationStatus, KitSummary, KitWorkspace, PracticeItemStats, ReadinessReport, SessionItem } from "@preptrace/shared";
import { api, ApiError, fetcher } from "./api";

export interface Me {
  id: string;
  email: string;
  name: string;
}

export function useMe() {
  return useSWR<{ user: Me }, ApiError>("/auth/me", fetcher, { revalidateOnFocus: false, shouldRetryOnError: false });
}

export function useKits() {
  // Poll only while a kit is generating so dashboard cards show live progress.
  return useSWR<{ kits: KitSummary[] }, ApiError>("/kits", fetcher, {
    refreshInterval: (data) => (data?.kits.some((k) => k.status === "generating") ? 2500 : 0),
  });
}

export function useKit(id: string | undefined) {
  return useSWR<{ kit: KitWorkspace }, ApiError>(id ? `/kits/${id}` : null, fetcher, { revalidateOnFocus: false });
}

export function useGenerationStatus(id: string | undefined, active: boolean) {
  return useSWR<{ status: GenerationStatus | null; kitStatus: string; rev: number }, ApiError>(
    id ? `/kits/${id}/generation-status` : null,
    fetcher,
    { refreshInterval: active ? 1200 : 0, revalidateOnFocus: active },
  );
}

export function useReadiness(id: string | undefined, enabled = true) {
  return useSWR<{ readiness: ReadinessReport }, ApiError>(id && enabled ? `/kits/${id}/weak-spots` : null, fetcher);
}

export function usePracticeStats(id: string | undefined, enabled = true) {
  return useSWR<{ stats: Record<string, PracticeItemStats> }, ApiError>(id && enabled ? `/kits/${id}/practice/stats` : null, fetcher);
}

export function useRecommended(id: string | undefined, minutes = 15, enabled = true) {
  return useSWR<{ items: SessionItem[]; estMinutes: number }, ApiError>(id && enabled ? `/kits/${id}/practice/recommended?minutes=${minutes}` : null, fetcher);
}

/**
 * Poll a job until it finishes. Used for scoped regenerations.
 */
export function useJobWatcher(kitId: string, onDone: (status: GenerationStatus) => void) {
  const [watching, setWatching] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const { data } = useSWR<{ status: GenerationStatus | null }, ApiError>(watching ? `/kits/${kitId}/generation-status#watch` : null, () => api(`/kits/${kitId}/generation-status`), {
    refreshInterval: 1000,
    onSuccess: (d) => {
      const s = d.status;
      if (s && ["completed", "partial", "failed"].includes(s.status)) {
        setWatching(false);
        doneRef.current(s);
      }
    },
  });
  return { watching, status: watching ? data?.status : null, start: () => setWatching(true) };
}

/**
 * Local-first editing with debounced persistence: the UI updates instantly and the
 * latest value is saved once typing pauses. Saves are serialised so they never race.
 */
export function useDebouncedSave<T>(save: (value: T) => Promise<void>, delay = 700) {
  const [state, setState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = latest.current;
    if (value === null) return chain.current;
    latest.current = null;
    setState("saving");
    chain.current = chain.current
      .then(() => saveRef.current(value))
      .then(() => setState((s) => (s === "saving" ? "saved" : s)))
      .catch(() => setState("error"));
    return chain.current;
  }, []);

  const schedule = useCallback(
    (value: T) => {
      latest.current = value;
      setState("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      void flush();
    }
  }, [flush]);

  return { schedule, flush, state };
}

export { api };
