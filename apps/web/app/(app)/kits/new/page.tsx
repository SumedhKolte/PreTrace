"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, CalendarDays, Check, FileText, Layers, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { JD_MAX_CHARS, JD_MIN_CHARS, MAX_DAYS, parseCompanyUrl } from "@preptrace/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, Input, Label, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PageHeader } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { cn, hostOf } from "@/lib/utils";

const STEPS = [
  { n: "01", label: "Job", icon: FileText },
  { n: "02", label: "Company", icon: Building2 },
  { n: "03", label: "Timeline", icon: CalendarDays },
  { n: "04", label: "Generate", icon: Wand2 },
];

function guessTitle(jd: string) {
  const first = jd.split("\n").map((l) => l.replace(/^[#*\s]+/, "").trim()).find(Boolean) ?? "";
  return first.length > 90 ? `${first.slice(0, 90)}…` : first;
}

export default function NewKitPage() {
  const [mode, setMode] = useState<"single" | "batch">("single");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Create an interview kit"
        description="We'll research the company, map every requirement to questions and plan each day until your interview."
        actions={
          <div className="flex gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Creation mode">
            {(["single", "batch"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn("flex h-7 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium", mode === m ? "bg-night text-white" : "text-muted hover:text-ink")}
              >
                {m === "single" ? <FileText className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
                {m === "single" ? "One role" : "Multiple roles"}
              </button>
            ))}
          </div>
        }
      />
      {mode === "single" ? <SingleFlow /> : <BatchFlow />}
    </div>
  );
}

function SingleFlow() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [jd, setJd] = useState("");
  const [url, setUrl] = useState("");
  const [days, setDays] = useState(5);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<{ kitId: string } | null>(null);

  const jdError = jd.trim().length < JD_MIN_CHARS ? `Paste at least ${JD_MIN_CHARS} characters of the job description` : jd.length > JD_MAX_CHARS ? `Keep it under ${JD_MAX_CHARS.toLocaleString()} characters` : null;
  const parsedUrl = useMemo(() => parseCompanyUrl(url), [url]);
  const urlError = parsedUrl.ok ? null : parsedUrl.message;
  const canNext = [!jdError, !urlError, days >= 1 && days <= MAX_DAYS, true][step];

  async function submit(force = false) {
    if (!parsedUrl.ok) return;
    setBusy(true);
    try {
      const res = await api<{ kitId: string }>("/kits", { body: { jd, companyUrl: parsedUrl.url, days, force } });
      router.push(`/kits/${res.kitId}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "DUPLICATE_KIT") {
        setDuplicate(e.details as { kitId: string });
        return;
      }
      toast.error("Couldn't start generation", e instanceof ApiError ? e.message : undefined);
    }
  }

  const next = () => {
    setTouched((t) => ({ ...t, [["jd", "url", "days"][step]]: true }));
    if (canNext) setStep((s) => Math.min(3, s + 1));
  };

  return (
    <Card className="overflow-hidden">
      {/* Step indicator */}
      <ol className="grid grid-cols-4 border-b border-line bg-canvas/60">
        {STEPS.map((s, i) => (
          <li key={s.n}>
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              aria-current={i === step ? "step" : undefined}
              className={cn("flex w-full items-center gap-2.5 px-3 py-3.5 text-left sm:px-5", i === step && "bg-surface")}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold",
                  i < step ? "bg-good text-white" : i === step ? "bg-night text-white" : "bg-sunken text-muted",
                )}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : s.n}
              </span>
              <span className={cn("hidden text-[13px] font-medium sm:block", i === step ? "text-ink" : "text-muted")}>{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="p-5 sm:p-7">
        {step === 0 && (
          <div className="animate-rise">
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Paste the job description</h2>
            <p className="mt-1 text-[13.5px] text-muted">The full posting works best. We only extract requirements that are actually written in it.</p>
            <div className="mt-5">
              <Label htmlFor="jd" hint={<span className={cn("tabular-nums", jd.length > JD_MAX_CHARS && "text-bad")}>{jd.length.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}</span>}>
                Job description
              </Label>
              <Textarea
                id="jd"
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, jd: true }))}
                rows={14}
                placeholder={"Senior Backend Engineer\n\nRequirements\n- 5+ years with Node.js and TypeScript\n- Deep knowledge of PostgreSQL\n…"}
                aria-invalid={touched.jd && !!jdError}
                aria-describedby="jd-err"
                className="min-h-72 font-[450]"
                autoFocus
              />
              <FieldError id="jd-err">{touched.jd && jdError}</FieldError>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-rise">
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Company website</h2>
            <p className="mt-1 text-[13.5px] text-muted">We&apos;ll follow links from the homepage to find about, engineering and hiring-process pages — respecting robots.txt.</p>
            <div className="mt-5">
              <Label htmlFor="url">Website URL</Label>
              <Input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, url: true }))}
                placeholder="acme.com"
                inputMode="url"
                autoComplete="url"
                aria-invalid={touched.url && !!urlError}
                aria-describedby="url-err url-help"
                autoFocus
              />
              <FieldError id="url-err">{touched.url && urlError}</FieldError>
              <p id="url-help" className="mt-2 text-[12.5px] text-muted">
                Example: <button type="button" className="font-mono text-ink-2 underline decoration-line-strong underline-offset-2" onClick={() => setUrl("https://stripe.com")}>https://stripe.com</button>
                {parsedUrl.ok && url && <span className="ml-2 text-good">✓ {hostOf(parsedUrl.url)}</span>}
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="animate-rise">
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Days until your interview</h2>
            <p className="mt-1 text-[13.5px] text-muted">The schedule is built deterministically for exactly this many days, hardest material first.</p>
            <div className="mt-8 flex flex-col items-center">
              <div className="text-[64px] font-semibold leading-none tabular-nums tracking-[-0.04em]">{days}</div>
              <div className="mt-2 text-[14px] text-muted">You have {days} day{days === 1 ? "" : "s"} to prepare.</div>
              <input
                type="range"
                min={1}
                max={MAX_DAYS}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                aria-label="Days until interview"
                className="mt-8 w-full max-w-md accent-[var(--color-accent-600)]"
              />
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[1, 3, 5, 7, 14, 30].map((d) => (
                  <button key={d} onClick={() => setDays(d)} className={cn("h-8 rounded-lg border px-3 text-[13px] font-medium", days === d ? "border-night bg-night text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>
                    {d} {d === 1 ? "day" : "days"}
                  </button>
                ))}
              </div>
              <div className="mt-5 flex items-center gap-2">
                <Label htmlFor="days-input">Exact</Label>
                <Input id="days-input" type="number" min={1} max={MAX_DAYS} value={days} onChange={(e) => setDays(Math.max(1, Math.min(MAX_DAYS, Number(e.target.value) || 1)))} className="h-9 w-20" />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-rise">
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Review</h2>
            <p className="mt-1 text-[13.5px] text-muted">Generation runs in the background and usually takes 1–3 minutes. You can watch every stage.</p>
            <dl className="mt-5 divide-y divide-line rounded-xl border border-line">
              {[
                ["Job", guessTitle(jd), 0],
                ["Company", parsedUrl.ok ? hostOf(parsedUrl.url) : url, 1],
                ["Timeline", `${days} day${days === 1 ? "" : "s"}`, 2],
              ].map(([k, v, s]) => (
                <div key={k as string} className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="w-20 shrink-0 text-[13px] text-muted">{k}</dt>
                  <dd className="min-w-0 flex-1 truncate text-[14px] font-medium">{v}</dd>
                  <button className="text-[12.5px] font-medium text-accent-700 hover:underline" onClick={() => setStep(s as number)}>
                    Edit
                  </button>
                </div>
              ))}
            </dl>
            <div className="mt-5 flex flex-wrap gap-1.5 text-[12px]">
              {["Requirement extraction", "Company crawl", "Hiring process", "Public research", "4 question categories", "Coverage check", "Flashcards", `${days}-day schedule`].map((s) => (
                <Badge key={s} tone="outline">{s}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line bg-canvas/60 px-5 py-3.5 sm:px-7">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} icon={<ArrowLeft className="h-4 w-4" />}>
          Back
        </Button>
        {step < 3 ? (
          <Button variant="dark" onClick={next}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="primary" size="lg" loading={busy} onClick={() => submit()} icon={<Sparkles className="h-4 w-4" />}>
            Generate My Prep Kit
          </Button>
        )}
      </div>

      <Modal
        open={!!duplicate}
        onOpenChange={(o) => !o && setDuplicate(null)}
        size="sm"
        title="You already have this kit"
        description="A kit with the same job description and company exists. Opening it avoids repeating the research and generation."
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDuplicate(null); void submit(true); }}>
              Create anyway
            </Button>
            <Button variant="primary" onClick={() => router.push(`/kits/${duplicate!.kitId}`)}>
              Open existing kit
            </Button>
          </>
        }
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------

interface Row {
  jd: string;
  url: string;
  days: number;
}

function BatchFlow() {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([{ jd: "", url: "", days: 5 }, { jd: "", url: "", days: 5 }]);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const valid = rows.every((r) => r.jd.trim().length >= JD_MIN_CHARS && parseCompanyUrl(r.url).ok && r.days >= 1 && r.days <= MAX_DAYS);

  function importJson() {
    try {
      const parsed = JSON.parse(json) as unknown;
      const arr = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown[] }).cases;
      if (!Array.isArray(arr)) throw new Error("Expected an array of cases");
      setRows(
        arr.slice(0, 10).map((c) => {
          const o = c as { jd?: string; company_url?: string; companyUrl?: string; days?: number };
          return { jd: o.jd ?? "", url: o.company_url ?? o.companyUrl ?? "", days: Number(o.days ?? 5) };
        }),
      );
      setShowJson(false);
      toast.success(`Imported ${Math.min(arr.length, 10)} role(s)`);
    } catch (e) {
      toast.error("Invalid JSON", (e as Error).message);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ results: { ok: boolean; kitId?: string; error?: { message: string } }[] }>("/kits/batch", {
        body: { cases: rows.map((r) => ({ jd: r.jd, companyUrl: parseCompanyUrl(r.url).ok ? (parseCompanyUrl(r.url) as { url: string }).url : r.url, days: r.days })) },
      });
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - ok;
      toast.success(`Started ${ok} kit${ok === 1 ? "" : "s"}`, failed ? `${failed} could not be started.` : "They'll appear on your dashboard with live progress.");
      router.push("/dashboard");
    } catch (e) {
      toast.error("Couldn't start batch", e instanceof ApiError ? e.message : undefined);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-muted">Prepare for several roles at once. Each becomes its own kit, generated in the background.</p>
        <Button size="sm" variant="ghost" onClick={() => setShowJson(true)}>
          Paste JSON cases
        </Button>
      </div>
      {rows.map((r, i) => {
        const urlOk = parseCompanyUrl(r.url).ok;
        return (
          <Card key={i} className="animate-rise p-5">
            <div className="mb-3 flex items-center justify-between">
              <Badge tone="dark">Role {i + 1}</Badge>
              {rows.length > 1 && (
                <Button variant="ghost" size="icon" aria-label={`Remove role ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Label htmlFor={`jd-${i}`} hint={`${r.jd.length} chars`}>Job description</Label>
            <Textarea id={`jd-${i}`} rows={5} value={r.jd} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, jd: e.target.value } : x)))} />
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
              <div>
                <Label htmlFor={`url-${i}`}>Company URL</Label>
                <Input id={`url-${i}`} value={r.url} placeholder="acme.com" aria-invalid={!!r.url && !urlOk} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              </div>
              <div>
                <Label htmlFor={`days-${i}`}>Days</Label>
                <Input id={`days-${i}`} type="number" min={1} max={MAX_DAYS} value={r.days} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)))} />
              </div>
            </div>
          </Card>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" disabled={rows.length >= 10} onClick={() => setRows([...rows, { jd: "", url: "", days: 5 }])} icon={<Plus className="h-4 w-4" />}>
          Add role
        </Button>
        <Button variant="primary" size="lg" disabled={!valid} loading={busy} onClick={submit} icon={<Sparkles className="h-4 w-4" />}>
          Generate {rows.length} kits
        </Button>
      </div>
      <Modal
        open={showJson}
        onOpenChange={setShowJson}
        title="Paste cases JSON"
        description='Same format as the batch evaluator: [{"id","jd","company_url","days"}]. Up to 10 roles.'
        footer={<Button variant="primary" onClick={importJson}>Import</Button>}
      >
        <Textarea rows={10} value={json} onChange={(e) => setJson(e.target.value)} className="font-mono text-[12.5px]" aria-label="Cases JSON" />
      </Modal>
    </div>
  );
}
