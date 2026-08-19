"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import type { ActionKind, CaseAction } from "@/lib/types"
import { ACTION_LABELS, formatDateTime, relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  UserPlus,
} from "lucide-react"

const KIND_ICON: Record<ActionKind, typeof UserPlus> = {
  ADD_MENTOR: UserPlus,
  CS_ASSESSMENT: CheckCircle2,
  PROTOTYPING_ASSESSMENT: CheckCircle2,
  SCHEDULE_MEETING: CalendarClock,
}

function StatusBadge({ status }: { status: CaseAction["status"] }) {
  if (status === "OK")
    return (
      <Badge variant="secondary" className="gap-1 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Delivered
      </Badge>
    )
  if (status === "PENDING")
    return (
      <Badge variant="secondary" className="gap-1 text-amber-600 dark:text-amber-400">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Sending
      </Badge>
    )
  return (
    <Badge variant="secondary" className="gap-1 text-destructive">
      <AlertTriangle className="size-3" aria-hidden="true" />
      Failed
    </Badge>
  )
}

export function Timeline({
  actions,
  isLoading,
}: {
  actions: CaseAction[] | undefined
  isLoading: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-muted-foreground" aria-hidden="true" />
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : !actions || actions.length === 0 ? (
          <Empty className="border-0 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Clock />
              </EmptyMedia>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>
                Actions you run on this group will appear here as a timeline.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="relative flex flex-col gap-6">
            {actions.map((a, i) => {
              const Icon = KIND_ICON[a.kind]
              const isLast = i === actions.length - 1
              const detail = a.detail as Record<string, unknown> | null
              return (
                <li key={a.id} className="relative flex gap-3">
                  {!isLast ? (
                    <span
                      className="absolute left-4 top-9 bottom-[-1.5rem] w-px -translate-x-1/2 bg-border"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={cn(
                      "z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full border bg-background",
                      a.status === "FAILED"
                        ? "border-destructive/40 text-destructive"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="flex flex-1 flex-col gap-1 pb-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{ACTION_LABELS[a.kind]}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    {detail && typeof detail.mentor === "string" ? (
                      <span className="text-sm text-muted-foreground">
                        Mentor: {detail.mentor}
                      </span>
                    ) : null}
                    {detail && typeof detail.host === "string" ? (
                      <span className="text-sm text-muted-foreground">
                        Host: {detail.host}
                      </span>
                    ) : null}
                    {a.error ? (
                      <span className="text-sm text-destructive">{a.error}</span>
                    ) : null}
                    <span
                      className="text-xs text-muted-foreground"
                      title={formatDateTime(a.created_at)}
                    >
                      {relativeTime(a.created_at)}
                      {a.actor ? ` · by ${a.actor}` : ""}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
