"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

// ---------------------------------------------------------------------------
// Modal (accessible: focus trap, Esc to close, labelled)
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  side,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  side?: boolean;
}) {
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(12,12,20,0.38)] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed z-50 flex max-h-[calc(100dvh-2rem)] flex-col border border-line bg-surface shadow-float outline-none data-[state=open]:animate-rise",
            side
              ? "inset-y-0 right-0 w-full max-w-lg rounded-none sm:inset-y-2 sm:right-2 sm:max-h-[calc(100dvh-1rem)] sm:rounded-2xl"
              : cn("left-1/2 top-1/2 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl", widths[size]),
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[13px] leading-relaxed text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Dialog</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Confirmation for destructive or regenerating actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  tone = "primary",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Dropdown menu
// ---------------------------------------------------------------------------

export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-float data-[state=open]:animate-fade-in", className)}
      >
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  );
}

export function MenuItem({ children, onSelect, icon, danger, disabled, shortcut }: { children: ReactNode; onSelect?: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean; shortcut?: string }) {
  return (
    <Dropdown.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2.5 rounded-lg px-2 text-[13px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-subtle",
        danger ? "text-bad" : "text-ink-2 data-[highlighted]:text-ink",
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-[11px] text-faint">{shortcut}</span>}
    </Dropdown.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Dropdown.Label className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{children}</Dropdown.Label>;
}

export function MenuSeparator() {
  return <Dropdown.Separator className="my-1 h-px bg-line" />;
}

export const MenuSub = Dropdown.Sub;
export function MenuSubTrigger({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <Dropdown.SubTrigger className="flex h-8 cursor-default select-none items-center gap-2.5 rounded-lg px-2 text-[13px] text-ink-2 outline-none data-[highlighted]:bg-subtle data-[state=open]:bg-subtle">
      <span className="flex h-4 w-4 items-center justify-center text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="flex-1">{children}</span>
      <span className="text-faint">›</span>
    </Dropdown.SubTrigger>
  );
}
export function MenuSubContent({ children }: { children: ReactNode }) {
  return (
    <Dropdown.Portal>
      <Dropdown.SubContent sideOffset={6} className="z-50 min-w-44 rounded-xl border border-line bg-surface p-1 shadow-float">
        {children}
      </Dropdown.SubContent>
    </Dropdown.Portal>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-64 rounded-lg bg-night px-2.5 py-1.5 text-xs leading-snug text-white shadow-float data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
