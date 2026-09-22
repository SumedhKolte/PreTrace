"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, MoreHorizontal, Pencil, Pin, PinOff, Plus, RefreshCw, Target, Trash2 } from "lucide-react";
import { itemState, type PracticeItemStats, type WorkspaceFlashcard } from "@preptrace/shared";
import { FlipCard } from "@/components/kit/flashcard";
import { liveFlashcards, useKitCtx } from "@/components/kit/kit-context";
import { STATE_LABEL, STATE_TONE } from "@/components/kit/labels";
import { RegenerateDialog } from "@/components/kit/regenerate-dialog";
import { Badge, IdTag } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { FieldError, Label, Textarea } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Modal } from "@/components/ui/overlay";
import { Meter } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { usePracticeStats } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const FILTERS = ["all", "weak", "unseen", "mastered"] as const;
type Filter = (typeof FILTERS)[number];

function classify(s?: PracticeItemStats): Exclude<Filter, "all"> | "learning" {
  if (!s || s.attempts === 0) return "unseen";
  if ((s.lastConfidence ?? 0) <= 2) return "weak";
  if ((s.lastConfidence ?? 0) >= 4) return "mastered";
  return "learning";
}

export default function FlashcardsPage() {
  const { kit, mutate, patchLocal } = useKitCtx();
  const toast = useToast();
  const stats = usePracticeStats(kit.id).data?.stats ?? {};
  const [filter, setFilter] = useState<Filter>("all");
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<WorkspaceFlashcard | "new" | null>(null);
  const [regen, setRegen] = useState(false);
  const cards = liveFlashcards(kit);
  const shown = cards.filter((c) => filter === "all" || classify(stats[`flashcard:${c.id}`]) === filter);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === "all" ? cards.length : cards.filter((c) => classify(stats[`flashcard:${c.id}`]) === f).length]));

  async function act(fn: (fs: WorkspaceFlashcard[]) => WorkspaceFlashcard[], req: () => Promise<unknown>, fail: string) {
    patchLocal((k) => ({ ...k, flashcards: fn(k.flashcards) }));
    try {
      await req();
    } catch (e) {
      toast.error(fail, e instanceof ApiError ? e.message : undefined);
    } finally {
      void mutate();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Filter flashcards">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("flex h-7 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium capitalize", filter === f ? "bg-night text-white" : "text-muted hover:text-ink")}>
              {f} <span className={cn("tabular-nums", filter === f ? "text-white/60" : "text-faint")}>{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/kits/${kit.id}/practice`} className={buttonClass("secondary", "sm")}>
            <Target className="h-3.5 w-3.5" /> Practise
          </Link>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRegen(true)}>
            Regenerate
          </Button>
          <Button size="sm" variant="dark" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing("new")}>
            Add flashcard
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={cards.length === 0 ? "No flashcards generated yet." : filter === "weak" ? "No weak cards" : filter === "mastered" ? "Nothing mastered yet" : "No unseen cards"}
          description={cards.length === 0 ? "Add your own or regenerate flashcards." : "Practise more to move cards between these groups."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c, i) => {
            const s = stats[`flashcard:${c.id}`];
            const state = itemState(c.meta);
            const reqs = kit.role.requirements.filter((r) => c.requirement_ids.includes(r.id));
            return (
              <div key={c.id} className="relative animate-rise" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <FlipCard
                  className="min-h-56"
                  flipped={!!flipped[c.id]}
                  onFlip={() => setFlipped((f) => ({ ...f, [c.id]: !f[c.id] }))}
                  front={c.front}
                  back={c.back}
                  footer={
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                      {reqs.map((r) => (
                        <span key={r.id} className="inline-flex items-center gap-1 text-[11.5px] text-muted">
                          <IdTag>{r.id}</IdTag> {r.topic}
                        </span>
                      ))}
                      <span className="ml-auto flex items-center gap-1.5">
                        {state !== "generated" && <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>}
                        <Meter value={s?.lastConfidence ?? null} />
                      </span>
                    </div>
                  }
                />
                <div className="absolute right-3 top-3">
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${c.id}`} onClick={(e) => e.stopPropagation()} className={flipped[c.id] ? "text-white/60 hover:bg-white/10 hover:text-white" : ""}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<Pencil />} onSelect={() => setEditing(c)}>
                        Edit
                      </MenuItem>
                      <MenuItem
                        icon={c.meta.pinned ? <PinOff /> : <Pin />}
                        onSelect={() =>
                          act(
                            (fs) => fs.map((x) => (x.id === c.id ? { ...x, meta: { ...x.meta, pinned: !x.meta.pinned } } : x)),
                            () => api(`/kits/${kit.id}/flashcards/${c.id}`, { method: "PATCH", body: { pinned: !c.meta.pinned } }),
                            "Couldn't update pin",
                          )
                        }
                      >
                        {c.meta.pinned ? "Unpin" : "Pin"}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        icon={<Trash2 />}
                        danger
                        onSelect={() =>
                          act(
                            (fs) => fs.map((x) => (x.id === c.id ? { ...x, meta: { ...x.meta, deleted: true } } : x)),
                            () => api(`/kits/${kit.id}/flashcards/${c.id}`, { method: "DELETE" }),
                            "Couldn't delete",
                          )
                        }
                      >
                        Delete
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FlashcardEditor card={editing} onClose={() => setEditing(null)} />
      <RegenerateDialog scope={regen ? "flashcards" : null} onClose={() => setRegen(false)} />
    </div>
  );
}

function FlashcardEditor({ card, onClose }: { card: WorkspaceFlashcard | "new" | null; onClose: () => void }) {
  const { kit, mutate } = useKitCtx();
  const toast = useToast();
  const isNew = card === "new";
  const initial = card && card !== "new" ? card : null;
  const [form, setForm] = useState({ front: "", back: "", requirement_ids: [] as string[] });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastCard, setLastCard] = useState<typeof card>(null);
  if (card !== lastCard) {
    setLastCard(card);
    setForm(initial ? { front: initial.front, back: initial.back, requirement_ids: initial.requirement_ids } : { front: "", back: "", requirement_ids: [] });
    setErr(null);
  }

  async function save() {
    if (!form.front.trim() || !form.back.trim()) return setErr("Both sides need content.");
    if (!form.requirement_ids.length) return setErr("Link at least one requirement.");
    setBusy(true);
    try {
      if (isNew) await api(`/kits/${kit.id}/flashcards`, { body: form });
      else await api(`/kits/${kit.id}/flashcards/${initial!.id}`, { method: "PATCH", body: { ...form, baseVersion: initial!.meta.version } });
      await mutate();
      toast.success(isNew ? "Flashcard added" : "Flashcard saved");
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={card !== null}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? "Add flashcard" : "Edit flashcard"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="fc-front">Front</Label>
          <Textarea id="fc-front" rows={2} value={form.front} onChange={(e) => setForm({ ...form, front: e.target.value })} autoFocus />
        </div>
        <div>
          <Label htmlFor="fc-back">Back</Label>
          <Textarea id="fc-back" rows={5} value={form.back} onChange={(e) => setForm({ ...form, back: e.target.value })} />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Requirements</legend>
          <div className="flex flex-wrap gap-1.5">
            {kit.role.requirements.map((r) => {
              const on = form.requirement_ids.includes(r.id);
              return (
                <button key={r.id} type="button" aria-pressed={on} onClick={() => setForm({ ...form, requirement_ids: on ? form.requirement_ids.filter((x) => x !== r.id) : [...form.requirement_ids, r.id] })} className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12px]", on ? "border-accent-300 bg-accent-50 text-accent-800" : "border-line text-muted")}>
                  <IdTag>{r.id}</IdTag> {r.topic}
                </button>
              );
            })}
          </div>
        </fieldset>
        <FieldError>{err}</FieldError>
      </div>
    </Modal>
  );
}
