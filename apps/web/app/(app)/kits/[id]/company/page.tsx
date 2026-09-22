"use client";

import { useState } from "react";
import { AlertTriangle, Building2, Globe, History, Pencil, RefreshCw, Route, ShieldQuestion } from "lucide-react";
import { useKitCtx } from "@/components/kit/kit-context";
import { RegenerateDialog } from "@/components/kit/regenerate-dialog";
import { ResearchSourceRow } from "@/components/kit/research-source";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, SectionLabel } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { pathOf, relativeTime } from "@/lib/utils";

export default function CompanyPage() {
  const { kit, mutate } = useKitCtx();
  const toast = useToast();
  const brief = kit.companyBrief;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ summary: brief.summary, what_they_do: brief.what_they_do });
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [regen, setRegen] = useState(false);
  const sources = kit.research.sources;
  const official = sources.filter((s) => s.type !== "public_discussion");
  const publicSrc = sources.filter((s) => s.type === "public_discussion");

  async function save() {
    setSaving(true);
    try {
      await api(`/kits/${kit.id}/company-brief`, { method: "PATCH", body: draft });
      await mutate();
      setEditing(false);
      toast.success("Brief saved", "Your edits are protected from regeneration.");
    } catch (e) {
      toast.error("Couldn't save", e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function restore(i: number) {
    await api(`/kits/${kit.id}/company-brief/revisions/${i}/restore`, { method: "POST", body: {} });
    await mutate();
    setHistoryOpen(false);
    toast.success("Previous version restored");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card>
          <CardHeader
            title={kit.source.company}
            description={brief.edited ? `Edited by you · ${relativeTime(brief.updatedAt)}` : "Generated from verified facts on the company's website"}
            icon={<Building2 className="h-4 w-4" />}
            action={
              <div className="flex gap-1">
                {kit.briefRevisions.length > 0 && (
                  <Button size="sm" variant="ghost" icon={<History className="h-3.5 w-3.5" />} onClick={() => setHistoryOpen(true)}>
                    History
                  </Button>
                )}
                {!editing && (
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setDraft({ summary: brief.summary, what_they_do: brief.what_they_do }); setEditing(true); }}>
                    Edit
                  </Button>
                )}
                <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRegen(true)}>
                  Regenerate
                </Button>
              </div>
            }
          />
          <CardBody className="space-y-5">
            <div>
              <SectionLabel>Summary</SectionLabel>
              {editing ? (
                <Textarea className="mt-2" rows={5} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} aria-label="Company summary" />
              ) : (
                <p className="mt-2 text-[15px] leading-relaxed text-ink">{brief.summary}</p>
              )}
            </div>
            <div>
              <SectionLabel>What they do</SectionLabel>
              {editing ? (
                <Textarea className="mt-2" rows={4} value={draft.what_they_do} onChange={(e) => setDraft({ ...draft, what_they_do: e.target.value })} aria-label="What they do" />
              ) : (
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{brief.what_they_do}</p>
              )}
            </div>
            {editing && (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button variant="primary" loading={saving} onClick={save}>
                  Save brief
                </Button>
              </div>
            )}
            {brief.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-4">
                <span className="mr-1 text-[12px] text-muted">Grounded in</span>
                {brief.sources.map((s) => (
                  <a key={s} href={s} target="_blank" rel="noopener noreferrer nofollow" className="rounded-md bg-subtle px-2 py-0.5 font-mono text-[11.5px] text-ink-2 hover:bg-sunken">
                    {pathOf(s)}
                  </a>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Hiring process" icon={<Route className="h-4 w-4" />} description={brief.hiring_process.found ? brief.hiring_process.summary : undefined} />
          <CardBody>
            {brief.hiring_process.found ? (
              <ol className="relative space-y-4">
                {brief.hiring_process.stages.map((s, i) => (
                  <li key={i} className="flex gap-3.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-night font-mono text-[12px] text-white">{i + 1}</span>
                    <div className="min-w-0 pt-0.5">
                      <div className="text-[14px] font-medium">{s.name}</div>
                      {s.description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{s.description}</p>}
                      <a href={s.source_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-block font-mono text-[11px] text-accent-700 hover:underline">
                        {pathOf(s.source_url)}
                      </a>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon={<ShieldQuestion />} title="No official hiring process information was discovered." description="We didn't find an interview-process page on the company's site, so no interview rounds are assumed." className="border-none bg-transparent py-8" />
            )}
            {brief.hiring_process.expectations.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <SectionLabel>What they expect</SectionLabel>
                <ul className="mt-2 space-y-1.5">
                  {brief.hiring_process.expectations.map((e) => (
                    <li key={e} className="text-[13.5px] text-ink-2">— {e}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Public interview discussion" icon={<Globe className="h-4 w-4" />} description="Third-party reports — unverified and not official company policy." />
          <CardBody>
            {brief.public_signals.length ? (
              <ul className="space-y-3">
                {brief.public_signals.map((p, i) => (
                  <li key={i} className="rounded-xl border border-[#fbe3b8] bg-warn-soft/50 p-3">
                    <p className="text-[13.5px] text-ink-2">{p.text}</p>
                    <a href={p.source_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-block truncate font-mono text-[11px] text-warn hover:underline">
                      {p.source_url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted">No public interview-process discussion was found for this company.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Research sources" description={`${official.filter((s) => s.status === "ok").length} pages read · ${official.filter((s) => s.status !== "ok").length} unavailable`} />
          <CardBody className="pt-2">
            <ul className="divide-y divide-line">{official.map((s) => <ResearchSourceRow key={s.url} source={s} />)}</ul>
            {publicSrc.length > 0 && (
              <>
                <SectionLabel className="mt-4">Public sources</SectionLabel>
                <ul className="divide-y divide-line">{publicSrc.map((s) => <ResearchSourceRow key={s.url} source={s} />)}</ul>
              </>
            )}
          </CardBody>
        </Card>
        {kit.research.limitations.length > 0 && (
          <Card className="p-5">
            <SectionLabel>Research limitations</SectionLabel>
            <ul className="mt-3 space-y-2">
              {kit.research.limitations.map((l) => (
                <li key={l} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> {l}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="px-1 text-[12px] text-muted">Researched {relativeTime(kit.source.researched_at).toLowerCase()} · <Badge tone="outline">robots.txt respected</Badge></p>
      </div>

      <Modal open={historyOpen} onOpenChange={setHistoryOpen} title="Brief history" description="Previous versions are kept whenever you edit or regenerate the brief.">
        <ul className="space-y-3">
          {kit.briefRevisions.map((r, i) => (
            <li key={i} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between">
                <Badge tone={r.reason === "edited" ? "accent" : "neutral"}>{r.reason === "edited" ? "Before your edit" : "Before regeneration"}</Badge>
                <Button size="sm" variant="secondary" onClick={() => restore(i)}>
                  Restore
                </Button>
              </div>
              <p className="mt-2 line-clamp-3 text-[13px] text-ink-2">{r.summary}</p>
              <p className="mt-1 text-[11.5px] text-faint">{relativeTime(r.savedAt)}</p>
            </li>
          ))}
        </ul>
      </Modal>
      <RegenerateDialog scope={regen ? "company" : null} onClose={() => setRegen(false)} />
    </div>
  );
}
