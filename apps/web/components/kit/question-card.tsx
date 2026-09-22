"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  FolderInput,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { itemState, QUESTION_CATEGORIES, type PracticeItemStats, type QuestionCategory, type WorkspaceQuestion } from "@preptrace/shared";
import { Badge, IdTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, Tooltip } from "@/components/ui/overlay";
import { Meter } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { useDebouncedSave } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useKitCtx } from "./kit-context";
import { CATEGORY_META, DifficultyDots, STATE_LABEL, STATE_TONE } from "./labels";

export interface QuestionActions {
  onPin: (q: WorkspaceQuestion) => void;
  onMove: (q: WorkspaceQuestion, c: QuestionCategory) => void;
  onDelete: (q: WorkspaceQuestion) => void;
  onShift: (q: WorkspaceQuestion, dir: -1 | 1) => void;
  onWhy: (q: WorkspaceQuestion) => void;
}

export function SortableQuestionCard(props: { question: WorkspaceQuestion; stats?: PracticeItemStats; actions: QuestionActions; index: number; total: number; dragDisabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.question.id, disabled: props.dragDisabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-90 [&>div]:shadow-float")}
    >
      <QuestionCard {...props} dragHandle={props.dragDisabled ? undefined : { ...attributes, ...listeners }} />
    </div>
  );
}

export function QuestionCard({
  question: q,
  stats,
  actions,
  index,
  total,
  dragHandle,
}: {
  question: WorkspaceQuestion;
  stats?: PracticeItemStats;
  actions: QuestionActions;
  index: number;
  total: number;
  dragHandle?: Record<string, unknown>;
}) {
  const { kit } = useKitCtx();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const state = itemState(q.meta);
  const cat = CATEGORY_META[q.category];
  const reqs = kit.role.requirements.filter((r) => q.requirement_ids.includes(r.id));

  return (
    <div className="card group/q overflow-hidden transition-shadow hover:shadow-raised">
      <div className="flex gap-2 p-4 pl-2 sm:pl-3">
        <button
          {...dragHandle}
          aria-label={`Reorder question ${q.id}`}
          className={cn("mt-0.5 flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-faint hover:bg-subtle hover:text-ink-2 active:cursor-grabbing", !dragHandle && "invisible")}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium ${cat.soft}`}>
              <cat.icon className="h-3 w-3" /> {cat.label}
            </span>
            <DifficultyDots value={q.difficulty} />
            {state !== "generated" && (
              <Badge tone={STATE_TONE[state]} icon={state === "pinned" ? <Pin className="h-3 w-3" /> : undefined}>
                {STATE_LABEL[state]}
              </Badge>
            )}
            {q.meta.producer === "gap_fill" && (
              <Tooltip content="Added by the deterministic coverage check to cover a must-have requirement.">
                <span>
                  <Badge tone="accent">Coverage fill</Badge>
                </span>
              </Tooltip>
            )}
            <span className="ml-auto font-mono text-[11px] text-faint">{q.id}</span>
          </div>

          {editing ? (
            <QuestionEditor question={q} onDone={() => setEditing(false)} />
          ) : (
            <>
              <button onClick={() => setOpen((o) => !o)} className="mt-2 block w-full text-left" aria-expanded={open}>
                <p className="text-[14.5px] font-medium leading-snug tracking-[-0.005em] text-ink">{q.prompt}</p>
              </button>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {reqs.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11.5px] text-ink-2">
                    <span className="font-mono text-faint">{r.id}</span> {r.topic}
                    {r.priority === "must" && <span className="h-1 w-1 rounded-full bg-ink" title="Must-have" />}
                  </span>
                ))}
                {stats?.attempts ? (
                  <span className="ml-1 flex items-center gap-1.5 text-[11.5px] text-muted">
                    <Meter value={stats.lastConfidence} /> {stats.lastConfidence}/5
                  </span>
                ) : null}
              </div>
              {open && (
                <div className="mt-3 animate-fade-in rounded-xl bg-subtle px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Answer outline</div>
                  <div className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{q.answer_outline}</div>
                </div>
              )}
            </>
          )}
        </div>

        {!editing && (
          <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-start">
            <Tooltip content="Why this question?">
              <Button variant="ghost" size="icon" aria-label="Why this question?" onClick={() => actions.onWhy(q)}>
                <CircleHelp className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Button variant="ghost" size="icon" aria-label={open ? "Hide answer outline" : "Show answer outline"} onClick={() => setOpen((o) => !o)} className="hidden sm:inline-flex">
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${q.id}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                  Edit
                </MenuItem>
                <MenuItem icon={q.meta.pinned ? <PinOff /> : <Pin />} onSelect={() => actions.onPin(q)}>
                  {q.meta.pinned ? "Unpin" : "Pin (protect from regeneration)"}
                </MenuItem>
                <MenuSub>
                  <MenuSubTrigger icon={<FolderInput />}>Move to…</MenuSubTrigger>
                  <MenuSubContent>
                    {QUESTION_CATEGORIES.filter((c) => c !== q.category).map((c) => (
                      <MenuItem key={c} onSelect={() => actions.onMove(q, c)}>
                        {CATEGORY_META[c].label}
                      </MenuItem>
                    ))}
                  </MenuSubContent>
                </MenuSub>
                <MenuItem icon={<ArrowUp />} disabled={index === 0} onSelect={() => actions.onShift(q, -1)}>
                  Move up
                </MenuItem>
                <MenuItem icon={<ArrowDown />} disabled={index === total - 1} onSelect={() => actions.onShift(q, 1)}>
                  Move down
                </MenuItem>
                <MenuItem icon={<CircleHelp />} onSelect={() => actions.onWhy(q)}>
                  Why this question?
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} danger onSelect={() => actions.onDelete(q)}>
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline editor with local-first state and debounced, version-checked autosave. */
function QuestionEditor({ question, onDone }: { question: WorkspaceQuestion; onDone: () => void }) {
  const { kit, patchLocal } = useKitCtx();
  const [draft, setDraft] = useState({
    prompt: question.prompt,
    answer_outline: question.answer_outline,
    difficulty: question.difficulty,
    category: question.category,
    requirement_ids: question.requirement_ids,
  });
  const version = useRef(question.meta.version);
  const [error, setError] = useState<string | null>(null);

  const saver = useDebouncedSave<typeof draft>(async (value) => {
    if (!value.prompt.trim() || !value.answer_outline.trim() || value.requirement_ids.length === 0) return;
    try {
      const res = await api<{ question: WorkspaceQuestion }>(`/kits/${kit.id}/questions/${question.id}`, {
        method: "PATCH",
        body: { ...value, baseVersion: version.current },
      });
      version.current = res.question.meta.version;
      setError(null);
      patchLocal((k) => ({ ...k, questions: k.questions.map((x) => (x.id === question.id ? res.question : x)) }));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  });

  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    saver.schedule(next);
  };

  const invalid = !draft.prompt.trim() ? "Question can't be empty" : !draft.answer_outline.trim() ? "Answer outline can't be empty" : draft.requirement_ids.length === 0 ? "Link at least one requirement" : null;

  return (
    <div className="mt-3 animate-fade-in space-y-3">
      <div>
        <Label htmlFor={`p-${question.id}`}>Question</Label>
        <Textarea id={`p-${question.id}`} rows={2} value={draft.prompt} onChange={(e) => update({ prompt: e.target.value })} autoFocus />
      </div>
      <div>
        <Label htmlFor={`o-${question.id}`}>Answer outline</Label>
        <Textarea id={`o-${question.id}`} rows={5} value={draft.answer_outline} onChange={(e) => update({ answer_outline: e.target.value })} className="text-[13.5px]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`c-${question.id}`}>Category</Label>
          <Select id={`c-${question.id}`} value={draft.category} onChange={(e) => update({ category: e.target.value as QuestionCategory })}>
            {QUESTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`d-${question.id}`}>Difficulty</Label>
          <Select id={`d-${question.id}`} value={draft.difficulty} onChange={(e) => update({ difficulty: Number(e.target.value) as 1 | 2 | 3 })}>
            <option value={1}>1 · Fundamentals</option>
            <option value={2}>2 · Applied</option>
            <option value={3}>3 · Advanced</option>
          </Select>
        </div>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Requirements</legend>
        <div className="flex flex-wrap gap-1.5">
          {kit.role.requirements.map((r) => {
            const on = draft.requirement_ids.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => update({ requirement_ids: on ? draft.requirement_ids.filter((x) => x !== r.id) : [...draft.requirement_ids, r.id] })}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12px]", on ? "border-accent-300 bg-accent-50 text-accent-800" : "border-line text-muted hover:border-line-strong")}
              >
                {on && <Check className="h-3 w-3" />} <IdTag>{r.id}</IdTag> {r.topic}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[12px] text-muted" aria-live="polite">
          {invalid ? (
            <span className="text-bad">{invalid}</span>
          ) : error ? (
            <span className="text-bad">{error}</span>
          ) : saver.state === "saving" || saver.state === "pending" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          ) : saver.state === "saved" ? (
            <span className="inline-flex items-center gap-1 text-good">
              <Check className="h-3 w-3" /> Saved · marked as edited
            </span>
          ) : (
            "Changes save automatically"
          )}
        </span>
        <Button
          size="sm"
          variant="dark"
          onClick={async () => {
            await saver.flush();
            onDone();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
