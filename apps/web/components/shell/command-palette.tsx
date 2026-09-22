"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { BookOpen, Building2, CalendarRange, FolderKanban, Gauge, LayoutDashboard, ListChecks, LogOut, Plus, RefreshCw, Settings, Target, UserSearch } from "lucide-react";
import type { KitSummary } from "@preptrace/shared";

/**
 * ⌘K command centre: navigation, kit search and kit-scoped actions.
 * Purely navigational — it never mutates data directly, so it can't bypass confirmations.
 */
export function CommandPalette({ open, onOpenChange, kits, onLogout }: { open: boolean; onOpenChange: (o: boolean) => void; kits: KitSummary[]; onLogout: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const kitId = /^\/kits\/([a-f0-9]{24})/.exec(pathname)?.[1];
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(12,12,20,0.32)] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-float data-[state=open]:animate-rise">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search kits and run quick actions</Dialog.Description>
          <Command loop className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-faint">
            <Command.Input autoFocus placeholder="Type a command or search kits…" className="h-12 w-full border-b border-line bg-transparent px-4 text-[14.5px] outline-none placeholder:text-faint" />
            <Command.List className="max-h-[52vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">No results.</Command.Empty>
              {kitId && (
                <Command.Group heading="This kit">
                  <Item icon={<Target />} onSelect={() => go(`/kits/${kitId}/practice`)}>Start practice</Item>
                  <Item icon={<Gauge />} onSelect={() => go(`/kits/${kitId}/weak-spots`)}>Open weak spots</Item>
                  <Item icon={<ListChecks />} onSelect={() => go(`/kits/${kitId}/questions`)}>Question bank</Item>
                  <Item icon={<RefreshCw />} onSelect={() => go(`/kits/${kitId}/questions?regenerate=technical`)}>Regenerate questions…</Item>
                  <Item icon={<CalendarRange />} onSelect={() => go(`/kits/${kitId}/schedule`)}>Go to schedule</Item>
                  <Item icon={<BookOpen />} onSelect={() => go(`/kits/${kitId}/flashcards`)}>Flashcards</Item>
                  <Item icon={<Building2 />} onSelect={() => go(`/kits/${kitId}/company`)}>Company brief</Item>
                  <Item icon={<UserSearch />} onSelect={() => go(`/kits/${kitId}/role`)}>Role breakdown</Item>
                </Command.Group>
              )}
              <Command.Group heading="Actions">
                <Item icon={<Plus />} onSelect={() => go("/kits/new")}>Create interview kit</Item>
                <Item icon={<LayoutDashboard />} onSelect={() => go("/dashboard")}>Go to dashboard</Item>
                <Item icon={<Target />} onSelect={() => go("/practice")}>Start practice</Item>
                <Item icon={<Gauge />} onSelect={() => go("/weak-spots")}>Open weak spots</Item>
                <Item icon={<Settings />} onSelect={() => go("/settings")}>Settings</Item>
              </Command.Group>
              {kits.length > 0 && (
                <Command.Group heading="Kits">
                  {kits.map((k) => (
                    <Item key={k.id} icon={<FolderKanban />} value={`${k.role} ${k.company}`} onSelect={() => go(`/kits/${k.id}`)}>
                      <span className="truncate">{k.role}</span>
                      <span className="ml-2 truncate text-faint">{k.company}</span>
                    </Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Account">
                <Item
                  icon={<LogOut />}
                  onSelect={() => {
                    onOpenChange(false);
                    onLogout();
                  }}
                >
                  Sign out
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Item({ children, icon, onSelect, value }: { children: ReactNode; icon: ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-ink-2 data-[selected=true]:bg-subtle data-[selected=true]:text-ink [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted"
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
    </Command.Item>
  );
}
