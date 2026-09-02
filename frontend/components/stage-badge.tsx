import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { STAGE_LABELS } from "@/lib/format"
import type { Stage } from "@/lib/types"

const STAGE_STYLES: Record<Stage, string> = {
  AWAITING_JOIN:
    "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-400",
  NEW: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  IN_PROGRESS:
    "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  AWAITING_MENTOR_JOIN:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  MENTOR_ASSIGNED:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  ABANDONED: "border-border bg-muted text-muted-foreground",
}

const DOT_STYLES: Record<Stage, string> = {
  AWAITING_JOIN: "bg-slate-400",
  NEW: "bg-amber-500",
  IN_PROGRESS: "bg-blue-500",
  AWAITING_MENTOR_JOIN: "bg-violet-500",
  MENTOR_ASSIGNED: "bg-emerald-500",
  ABANDONED: "bg-muted-foreground/50",
}

export function StageBadge({
  stage,
  className,
}: {
  stage: Stage
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", STAGE_STYLES[stage], className)}
    >
      <span className={cn("size-1.5 rounded-full", DOT_STYLES[stage])} />
      {STAGE_LABELS[stage]}
    </Badge>
  )
}
