"use client"

import * as React from "react"
import { toast } from "sonner"
import { Clock, X } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useQueue } from "@/hooks/use-data"
import { cancelQueuedAction } from "@/lib/api"
import { ACTION_LABELS } from "@/lib/format"
import { useCanSendActions } from "@/components/auth/auth-provider"
import type { GroupCase, QueuedAction } from "@/lib/types"

/** A one-line description of what a queued action will do when it runs. */
function describe(item: QueuedAction): string {
  const params = item.params ?? {}
  switch (item.kind) {
    case "ADD_MENTOR": {
      const mentor = String(params.mentor ?? "")
      const variant = params.variant ? ` (${String(params.variant)})` : ""
      return `${mentor}${variant}`
    }
    case "SCHEDULE_MEETING":
      return String(params.host ?? "")
    case "CS_ASSESSMENT":
    case "PROTOTYPING_ASSESSMENT": {
      const days = Number(params.deadline_days)
      return Number.isFinite(days) ? `${days}-day deadline` : ""
    }
    default:
      return ""
  }
}

const STATUS_STYLES: Record<QueuedAction["status"], string> = {
  QUEUED: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  SENT: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
  CANCELLED: "border-border bg-muted text-muted-foreground",
}

export function QueuePanel({ groupCase }: { groupCase: GroupCase }) {
  const { data: queue, isLoading, mutate } = useQueue(groupCase.id)
  const [cancelling, setCancelling] = React.useState<string | null>(null)
  const canSend = useCanSendActions()

  // Cancelled items are noise once they're gone -- the timeline is where the
  // record of what actually happened lives.
  const items = (queue ?? []).filter((q) => q.status !== "CANCELLED")
  if (!isLoading && items.length === 0) return null

  const waiting = groupCase.stage === "AWAITING_JOIN"
  const stopped = items.some((q) => q.status === "FAILED")

  async function handleCancel(id: string) {
    setCancelling(id)
    try {
      await cancelQueuedAction(groupCase.id, id)
      toast.success("Removed from the queue")
      await mutate()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove it. Please try again.",
      )
    } finally {
      setCancelling(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4" />
          Queued actions
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {stopped
            ? "Something failed, so the queue is on hold. Nothing else sends until it is sorted out."
            : waiting
              ? "These will send in order once the family joins and the welcome message goes out."
              : "These are sending in order, spaced a little apart."}
        </p>

        {isLoading ? (
          <Spinner />
        ) : (
          <ol className="flex flex-col gap-2">
            {items.map((item, i) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {i + 1}. {ACTION_LABELS[item.kind] ?? item.kind}
                  </span>
                  {describe(item) ? (
                    <span className="text-xs text-muted-foreground">{describe(item)}</span>
                  ) : null}
                  {item.error ? (
                    <span className="text-xs text-destructive">{item.error}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline" className={STATUS_STYLES[item.status]}>
                    {item.status}
                  </Badge>
                  {canSend && item.status === "QUEUED" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove from queue"
                      disabled={cancelling === item.id}
                      onClick={() => handleCancel(item.id)}
                    >
                      {cancelling === item.id ? <Spinner /> : <X className="size-4" />}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
