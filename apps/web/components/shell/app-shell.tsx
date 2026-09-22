"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { mutate } from "swr";
import { Command, FolderKanban, Gauge, LayoutDashboard, LogOut, Plus, Search, Settings, Target } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/brand";
import { buttonClass } from "@/components/ui/button";
import { Kbd } from "@/components/ui/badge";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { PageSkeleton } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useKits, useMe } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/kits", label: "My Kits", icon: FolderKanban },
  { href: "/practice", label: "Practice", icon: Target },
  { href: "/weak-spots", label: "Weak Spots", icon: Gauge },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/kits") return pathname === "/kits" || (pathname.startsWith("/kits/") && !pathname.endsWith("/practice") && !pathname.endsWith("/weak-spots"));
  if (href === "/practice") return pathname === "/practice" || pathname.endsWith("/practice");
  if (href === "/weak-spots") return pathname === "/weak-spots" || pathname.endsWith("/weak-spots");
  return pathname === href;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const kits = useKits();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Session guard: the API is the source of truth for authentication.
  useEffect(() => {
    if (me.error?.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.error, pathname, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    await mutate(() => true, undefined, { revalidate: false });
    router.replace("/login");
  }

  const user = me.data?.user;
  const recent = (kits.data?.kits ?? []).slice(0, 5);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-canvas/80 backdrop-blur lg:flex">
        <div className="px-4 pb-3 pt-4">
          <Link href="/dashboard" className="block rounded-lg p-1">
            <Wordmark />
          </Link>
        </div>
        <div className="space-y-2 px-3">
          <Link href="/kits/new" className={buttonClass("dark", "md", "w-full justify-start")}>
            <Plus className="h-4 w-4" /> New interview kit
          </Link>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] text-muted shadow-card hover:border-line-strong"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </button>
        </div>
        <nav aria-label="Main" className="mt-4 space-y-0.5 px-3">
          {NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors",
                  active ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-ink-2 hover:bg-subtle hover:text-ink",
                )}
              >
                <n.icon className={cn("h-4 w-4", active ? "text-accent-600" : "text-muted")} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        {recent.length > 0 && (
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3">
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Recent kits</div>
            <div className="space-y-0.5">
              {recent.map((k) => (
                <Link
                  key={k.id}
                  href={`/kits/${k.id}`}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-subtle hover:text-ink",
                    pathname.startsWith(`/kits/${k.id}`) && "bg-subtle text-ink",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", k.status === "generating" ? "animate-pulse-dot bg-accent-500" : k.status === "failed" ? "bg-bad" : "bg-good")} />
                  <span className="truncate">{k.role === "Analysing role…" ? k.company : `${k.role}`}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        <div className="mt-auto border-t border-line p-3">
          <Menu>
            <MenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-subtle" aria-label="Account menu">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-100 text-[13px] font-semibold text-accent-700">
                  {user?.name?.[0]?.toUpperCase() ?? "·"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{user?.name ?? "…"}</span>
                  <span className="block truncate text-[11.5px] text-muted">{user?.email ?? ""}</span>
                </span>
              </button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuLabel>Account</MenuLabel>
              <MenuItem icon={<Settings />} onSelect={() => router.push("/settings")}>
                Settings
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<LogOut />} onSelect={logout}>
                Sign out
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/85 px-4 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2" aria-label="Dashboard">
          <LogoMark />
          <span className="text-[15px] font-bold tracking-tight">PrepTrace</span>
        </Link>
        <div className="flex items-center gap-1">
          <button onClick={() => setPaletteOpen(true)} className={buttonClass("ghost", "icon")} aria-label="Search">
            <Command className="h-4 w-4" />
          </button>
          <Link href="/kits/new" className={buttonClass("dark", "sm")}>
            <Plus className="h-4 w-4" /> New
          </Link>
        </div>
      </header>

      <main className="pb-24 lg:pb-10 lg:pl-[248px]">
        <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{me.isLoading && !user ? <PageSkeleton /> : children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-medium", active ? "text-accent-700" : "text-muted")}>
              <n.icon className="h-5 w-5" />
              {n.label.replace("My ", "")}
            </Link>
          );
        })}
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} kits={kits.data?.kits ?? []} onLogout={logout} />
    </div>
  );
}
