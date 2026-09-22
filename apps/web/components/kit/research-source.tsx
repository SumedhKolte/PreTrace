import { AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";
import type { ResearchSource as Source } from "@preptrace/shared";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/overlay";
import { cn, pathOf } from "@/lib/utils";
import { SOURCE_TYPE } from "./labels";

export function ResearchSourceRow({ source }: { source: Source }) {
  const t = SOURCE_TYPE[source.type];
  const ok = source.status === "ok";
  return (
    <li className="flex items-start gap-3 py-3">
      <div className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", ok ? "bg-good" : source.status === "blocked" ? "bg-warn" : "bg-bad")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {ok ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 text-[13.5px] font-medium text-ink hover:text-accent-700">
              <span className="truncate">{source.title || pathOf(source.url)}</span>
              <ExternalLink className="h-3 w-3 shrink-0 text-faint" />
            </a>
          ) : (
            <span className="truncate text-[13.5px] font-medium text-muted">{pathOf(source.url)}</span>
          )}
          <Badge tone={t.tone}>{t.label}</Badge>
          {source.relevance === "inferred" && (
            <Tooltip content="Found by company name on a third-party site. It may not be about this exact company.">
              <span>
                <Badge tone="outline">Inferred relevance</Badge>
              </span>
            </Tooltip>
          )}
          {source.flags?.includes("suspicious_instructions_ignored") && (
            <Tooltip content="This page contained text trying to instruct an AI. It was treated as plain data and ignored.">
              <span>
                <Badge tone="warn" icon={<ShieldAlert className="h-3 w-3" />}>
                  Injection ignored
                </Badge>
              </span>
            </Tooltip>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11.5px] text-faint">{source.url}</div>
        {!ok && (
          <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
            <AlertTriangle className="h-3 w-3" /> {source.note ?? "Source unavailable"}
          </div>
        )}
        {ok && source.note && <div className="mt-1 text-[12.5px] text-muted">{source.note}</div>}
        {source.used_for.length > 0 && <div className="mt-1 text-[12px] text-muted">Used to generate: {source.used_for.join(", ")}</div>}
      </div>
    </li>
  );
}
