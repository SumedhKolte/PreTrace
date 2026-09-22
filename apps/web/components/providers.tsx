"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { ToastProvider } from "./ui/toast";
import { TooltipProvider } from "./ui/overlay";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ shouldRetryOnError: (err) => (err as { status?: number })?.status !== 401 && (err as { status?: number })?.status !== 404, errorRetryCount: 2 }}>
      <TooltipProvider>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </SWRConfig>
  );
}
