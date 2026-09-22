"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ListChecks, Plus, RefreshCw, RotateCcw, Search } from "lucide-react";
import { CATEGORY_LABELS, QUESTION_CATEGORIES, type QuestionCategory, type RegenerateScope, type WorkspaceQuestion } from "@preptrace/shared";
import { EvidencePanel } from "@/components/kit/evidence-panel";
import { liveQuestions, useKitCtx } from "@/components/kit/kit-context";
import { CATEGORY_META } from "@/components/kit/labels";
import { SortableQuestionCard, type QuestionActions } from "@/components/kit/question-card";
import { RegenerateDialog } from "@/components/kit/regenerate-dialog";
import { IdTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { usePracticeStats } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type Tab = "all" | QuestionCategory;

export default function QuestionsPage() {
  const { kit, patchLocal, mutate } = useKitCtx();
  const toast = useToast();
  const stats = usePracticeStats(kit.id).data?.stats ?? {};
  // Deep link from the command palette: ?regenerate=<category>
  const params = useSearchParams();
  const deepLink = params.get("regenerate") as QuestionCategory | null;
  const linked = deepLink && QUESTION_CATEGORIES.includes(deepLink) ? deepLink : null;
  const [tab, setTab] = useState<Tab>(linked ?? "all");
  const [query, setQuery] = useState("");
  const [why, setWhy] = useState<WorkspaceQuestion | null>(null);
  const [adding, setAdding] = useState(false);
  const [regen, setRegen] = useState<RegenerateScope | null>(linked);
  const [showDeleted, setShowDeleted] = useState(false);

  const all = liveQuestions(kit);
  const visible = useMemo(
    () => (tab === "all" ? all : all.filter((q) => q.category === tab)).filter((q) => !query || q.prompt.toLowerCase().includes(query.toLowerCase())),
    [all, tab, query],
  );
  const deleted = kit.questions.filter((q) => q.meta.deleted);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Optimistic helper: apply locally, persist, roll back by revalidating on failure. */
  async function optimistic(fn: (qs: WorkspaceQuestion[]) => WorkspaceQuestion[], request: () => Promise<unknown>, failMsg: string) {
    patchLocal((k) => ({ ...k, questions: fn(k.questions) }));
    try {
      await request();
    } catch (e) {
      toast.error(failMsg, e instanceof ApiError ? e.message : undefined);
    } finally {
      void mutate();
    }
  }

  async function persistOrder(ids: string[]) {
    const slots = ids.map((id) => all.find((q) => q.id === id)!.order).sort((a, b) => a - b);
    const next = new Map(ids.map((id, i) => [id, slots[i]]));
    await optimistic((qs) => qs.map((q) => (next.has(q.id) ? { ...q, order: next.get(q.id)! } : q)), () => api(`/kits/${kit.id}/questions/order`, { method: "PUT", body: { ids } }), "Couldn't reorder");
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = visible.map((q) => q.id);
    void persistOrder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  }

  const actions: QuestionActions = {
    onWhy: setWhy,
    onPin: (q) =>
      optimistic(
        (qs) => qs.map((x) => (x.id === q.id ? { ...x, meta: { ...x.meta, pinned: !x.meta.pinned } } : x)),
        () => api(`/kits/${kit.id}/questions/${q.id}/pin`, { body: { pinned: !q.meta.pinned } }),
        "Couldn't update pin",
      ),
    onMove: (q, c) =>
      optimistic(
        (qs) => qs.map((x) => (x.id === q.id ? { ...x, category: c, meta: { ...x.meta, edited: x.meta.origin === "generated" ? true : x.meta.edited } } : x)),
        async () => {
          await api(`/kits/${kit.id}/questions/${q.id}`, { method: "PATCH", body: { category: c } });
          toast.success(`Moved to ${CATEGORY_LABELS[c]}`);
        },
        "Couldn't move question",
      ),
    onDelete: (q) =>
      optimistic(
        (qs) => qs.map((x) => (x.id === q.id ? { ...x, meta: { ...x.meta, deleted: true } } : x)),
        async () => {
          await api(`/kits/${kit.id}/questions/${q.id}`, { method: "DELETE" });
          toast.info("Question deleted", "It won't be regenerated.", { label: "Undo", onClick: () => void restore(q.id) });
        },
        "Couldn't delete question",
      ),
    onShift: (q, dir) => {
      const ids = visible.map((x) => x.id);
      const i = ids.indexOf(q.id);
      if (i + dir < 0 || i + dir >= ids.length) return;
      void persistOrder(arrayMove(ids, i, i + dir));
    },
  };

  async function restore(id: string) {
    await optimistic((qs) => qs.map((x) => (x.id === id ? { ...x, meta: { ...x.meta, deleted: false } } : x)), () => api(`/kits/${kit.id}/questions/${id}/restore`, { body: {} }), "Couldn't restore");
  }

  const counts = Object.fromEntries(QUESTION_CATEGORIES.map((c) => [c, all.filter((q) => q.category === c).length])) as Record<QuestionCategory, number>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3">
        <div className="no-scrollbar -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="Question categories">
          {(["all", ...QUESTION_CATEGORIES] as Tab[]).map((t) => {
            const active = tab === t;
            const meta = t === "all" ? null : CATEGORY_META[t];
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
                  active ? "bg-night text-white" : "text-ink-2 hover:bg-subtle",
                )}
              >
                {meta && <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />}
                {t === "all" ? "All" : meta!.label}
                <span className={cn("tabular-nums", active ? "text-white/60" : "text-faint")}>{t === "all" ? all.length : counts[t]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative mr-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter questions" className="h-8 w-44 pl-8 text-[13px]" aria-label="Filter questions" />
          </div>
          {tab !== "all" && (
            <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRegen(tab)}>
              Regenerate {CATEGORY_LABELS[tab]}
            </Button>
          )}
          <Button size="sm" variant="dark" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
            Add question
          </Button>
        </div>
      </div>

      {tab === "system_design" && counts.system_design === 0 && kit.generation.systemDesignJustification && (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-muted">{kit.generation.systemDesignJustification} You can still add your own or regenerate this category.</p>
      )}

      {visible.length === 0 ? (
        <EmptyState icon={<ListChecks />} title={query ? "No questions match" : "No questions in this category"} description={query ? "Try a different filter." : "Add your own, or regenerate this category."} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((q) => q.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2.5">
              {visible.map((q, i) => (
                <SortableQuestionCard key={q.id} question={q} index={i} total={visible.length} stats={stats[`question:${q.id}`]} actions={actions} dragDisabled={!!query} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {deleted.length > 0 && (
        <div className="rounded-xl border border-dashed border-line-strong">
          <button className="flex w-full items-center justify-between px-4 py-3 text-[13px] text-muted hover:text-ink" onClick={() => setShowDeleted((s) => !s)} aria-expanded={showDeleted}>
            <span>Deleted questions ({deleted.length}) — kept so they are never regenerated</span>
            <span>{showDeleted ? "Hide" : "Show"}</span>
          </button>
          {showDeleted && (
            <ul className="divide-y divide-line border-t border-line">
              {deleted.map((q) => (
                <li key={q.id} className="flex items-center gap-3 px-4 py-2.5">
                  <IdTag>{q.id}</IdTag>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted line-through">{q.prompt}</span>
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => restore(q.id)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <EvidencePanel question={why} open={!!why} onOpenChange={(o) => !o && setWhy(null)} stats={why ? stats[`question:${why.id}`] : undefined} />
      <RegenerateDialog scope={regen} onClose={() => setRegen(null)} />
      <AddQuestionModal open={adding} onOpenChange={setAdding} defaultCategory={tab === "all" ? "technical" : tab} />
    </div>
  );
}

function AddQuestionModal({ open, onOpenChange, defaultCategory }: { open: boolean; onOpenChange: (o: boolean) => void; defaultCategory: QuestionCategory }) {
  const { kit, mutate } = useKitCtx();
  const toast = useToast();
  const [form, setForm] = useState({ prompt: "", answer_outline: "", difficulty: 2 as 1 | 2 | 3, category: defaultCategory, requirement_ids: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the category when the dialog opens (derived during render, no effect needed).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setForm((f) => ({ ...f, category: defaultCategory }));
  }

  async function submit() {
    if (!form.prompt.trim()) return setError("Write the question.");
    if (form.requirement_ids.length === 0) return setError("Link at least one requirement so coverage stays traceable.");
    setBusy(true);
    try {
      await api(`/kits/${kit.id}/questions`, { body: form });
      await mutate();
      toast.success("Question added", "Marked as manual — regeneration will never remove it.");
      setForm({ prompt: "", answer_outline: "", difficulty: 2, category: defaultCategory, requirement_ids: [] });
      setError(null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't add question");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add a question"
      description="Manual questions are always kept when you regenerate."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Add question
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="new-q">Question</Label>
          <Textarea id="new-q" rows={2} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} autoFocus />
        </div>
        <div>
          <Label htmlFor="new-o" hint="Optional">Answer outline</Label>
          <Textarea id="new-o" rows={4} value={form.answer_outline} onChange={(e) => setForm({ ...form, answer_outline: e.target.value })} placeholder="- Key point one&#10;- Key point two" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-c">Category</Label>
            <Select id="new-c" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as QuestionCategory })}>
              {QUESTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="new-d">Difficulty</Label>
            <Select id="new-d" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) as 1 | 2 | 3 })}>
              <option value={1}>1 · Fundamentals</option>
              <option value={2}>2 · Applied</option>
              <option value={3}>3 · Advanced</option>
            </Select>
          </div>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Requirements it assesses</legend>
          <div className="flex flex-wrap gap-1.5">
            {kit.role.requirements.map((r) => {
              const on = form.requirement_ids.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setForm({ ...form, requirement_ids: on ? form.requirement_ids.filter((x) => x !== r.id) : [...form.requirement_ids, r.id] })}
                  className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12px]", on ? "border-accent-300 bg-accent-50 text-accent-800" : "border-line text-muted hover:border-line-strong")}
                >
                  <IdTag>{r.id}</IdTag> {r.topic}
                </button>
              );
            })}
          </div>
        </fieldset>
        <FieldError>{error}</FieldError>
      </div>
    </Modal>
  );
}
