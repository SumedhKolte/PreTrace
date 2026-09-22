"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  Download,
  ExternalLink,
  FileJson,
  Loader2,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Target,
  Trash2,
} from "lucide-react";
import type { RegenerateScope } from "@preptrace/shared";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { ConfirmDialog, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Modal } from "@/components/ui/overlay";
import { ProgressBar, ReadinessRing } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { cn, daysUntil, hostOf } from "@/lib/utils";
import { SCOPE_LABELS, useKitCtx } from "./kit-context";
import { RegenerateDialog } from "./regenerate-dialog";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/company", label: "Company" },
  { href: "/role", label: "Role" },
  { href: "/questions", label: "Questions" },
  { href: "/flashcards", label: "Flashcards" },
  { href: "/schedule", label: "Schedule" },
  { href: "/practice", label: "Practice" },
  { href: "/weak-spots", label: "Weak Spots" },
];

export function KitHeader() {
  const { kit, readiness, regenerating, mutate } = useKitCtx();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const base = `/kits/${kit.id}`;
  const interview = new Date(new Date(kit.createdAt).getTime() + kit.input.days * 86_400_000).toISOString();
  const left = daysUntil(interview);
  const [regenScope, setRegenScope] = useState<RegenerateScope | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [days, setDays] = useState(kit.input.days);

  function exportJson() {
    window.open(`/api/kits/${kit.id}/export`, "_blank", "noopener");
  }

  return (
    <header className="space-y-5">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <a href={kit.source.company_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink">
              {kit.source.company || hostOf(kit.input.companyUrl)} <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-faint">·</span>
            <span className="capitalize">{kit.role.seniority !== "unspecified" ? kit.role.seniority : "Seniority n/a"}</span>
            {kit.role.location && kit.role.location !== "Not specified" && (
              <>
                <span className="text-faint">·</span>
                <span>{kit.role.location}</span>
              </>
            )}
          </div>
          <h1 className="mt-1.5 text-balance text-[26px] font-semibold leading-tight tracking-[-0.025em]">{kit.role.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={left !== null && left <= 2 ? "warn" : "neutral"} icon={<CalendarClock className="h-3 w-3" />}>
              {left === 0 ? "Interview today" : `Interview in ${left} day${left === 1 ? "" : "s"}`}
            </Badge>
            {kit.status === "partial" && <Badge tone="warn">Partial kit — see warnings</Badge>}
            <Badge tone={kit.coverage.uncovered_requirement_ids.length ? "bad" : "good"}>
              {kit.role.requirements.filter((r) => r.priority === "must").length - kit.coverage.uncovered_requirement_ids.length}/
              {kit.role.requirements.filter((r) => r.priority === "must").length} must-haves covered
            </Badge>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {readiness && (
            <div className="hidden items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 shadow-card sm:flex">
              <ReadinessRing value={readiness.overall} size={40} stroke={4} />
              <div className="text-[12px] leading-tight">
                <div className="text-muted">Readiness</div>
                <div className="font-medium">{readiness.weakSpots.length} weak spots</div>
              </div>
            </div>
          )}
          <Link href={`${base}/practice`} className={buttonClass("primary", "md")}>
            <Target className="h-4 w-4" /> Practice
          </Link>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" disabled={!!regenerating} icon={regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}>
                <span className="hidden sm:inline">Regenerate</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Regenerate a section</MenuLabel>
              {(["company", "technical", "behavioural", "system_design", "company_fit", "flashcards", "schedule"] as RegenerateScope[]).map((s) => (
                <MenuItem key={s} onSelect={() => setRegenScope(s)}>
                  {SCOPE_LABELS[s]}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Export</MenuLabel>
              <MenuItem icon={<FileJson />} onSelect={exportJson}>
                Download kit JSON
              </MenuItem>
              <MenuItem icon={<Printer />} onSelect={() => router.push(`/print/${kit.id}`)}>
                Print prep sheet
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<CalendarClock />} onSelect={() => setTimelineOpen(true)}>
                Change interview date
              </MenuItem>
              <MenuItem icon={<Download />} onSelect={() => navigator.clipboard?.writeText(window.location.href).then(() => toast.success("Link copied"))}>
                Copy link
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirmDelete(true)}>
                Delete kit
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      {regenerating && (
        <div className="flex animate-rise flex-col gap-2 rounded-xl border border-accent-100 bg-accent-50 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" role="status">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-accent-800">
            <Loader2 className="h-4 w-4 animate-spin" /> Regenerating {SCOPE_LABELS[regenerating.scope].toLowerCase()}
          </div>
          <div className="min-w-0 flex-1 truncate text-[12.5px] text-accent-700">{regenerating.status?.events.at(-1)?.message ?? "Queued…"}</div>
          <ProgressBar value={regenerating.status?.progress ?? 5} className="sm:w-40" />
        </div>
      )}

      <nav aria-label="Kit sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => {
            const href = `${base}${t.href}`;
            const active = t.href === "" ? pathname === base : pathname.startsWith(href);
            return (
              <Link
                key={t.label}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative px-3 pb-3 pt-1 text-[13.5px] font-medium transition-colors",
                  active ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ink" : "text-muted hover:text-ink",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <RegenerateDialog scope={regenScope} onClose={() => setRegenScope(null)} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title="Delete this kit?"
        description="This permanently removes the kit, its practice history and weak-spot data. This can't be undone."
        confirmLabel="Delete kit"
        onConfirm={async () => {
          await api(`/kits/${kit.id}`, { method: "DELETE" });
          toast.success("Kit deleted");
          router.replace("/dashboard");
        }}
      />

      <Modal
        open={timelineOpen}
        onOpenChange={setTimelineOpen}
        size="sm"
        title="Change interview date"
        description="The schedule is rebuilt deterministically for the new number of days. Days you edited are kept where they still fit."
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api(`/kits/${kit.id}`, { method: "PATCH", body: { days } });
                await mutate();
                setTimelineOpen(false);
                toast.success(`Schedule rebuilt for ${days} days`);
              } catch (e) {
                toast.error("Couldn't update", e instanceof ApiError ? e.message : undefined);
              }
            }}
          >
            Update schedule
          </Button>
        }
      >
        <Label htmlFor="kit-days">Days from kit creation</Label>
        <Input id="kit-days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
      </Modal>
    </header>
  );
}
