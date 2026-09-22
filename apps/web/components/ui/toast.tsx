"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const Ctx = createContext<{ push: (t: Omit<ToastItem, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 4500);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-float"
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />
            ) : t.tone === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink">{t.title}</div>
              {t.description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t.description}</div>}
              {t.action && (
                <button
                  className="mt-1.5 text-[12.5px] font-medium text-accent-700 hover:underline"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className={cn("rounded p-0.5 text-faint hover:bg-subtle hover:text-ink")}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return {
    success: (title: string, description?: string) => ctx.push({ tone: "success", title, description }),
    error: (title: string, description?: string) => ctx.push({ tone: "error", title, description }),
    info: (title: string, description?: string, action?: ToastItem["action"]) => ctx.push({ tone: "info", title, description, action }),
  };
}
