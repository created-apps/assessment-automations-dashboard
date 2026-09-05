"use client"

import * as React from "react"
import { toast } from "sonner"
import { OctagonX } from "lucide-react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useCanSendActions } from "@/components/auth/auth-provider"
import { stopOperations } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The kill switch, as the team meets it.
 *
 * Stopping is one click and a confirmation, and it cannot be undone from the
 * dashboard — so the confirmation spells out what stops rather than asking
 * "are you sure?". Someone reaching for this is usually reacting to something
 * that has gone wrong for a family; the dialog's job is to make sure they know
 * the blast radius before they commit, not to slow them down.
 */

/** The fields this needs. Both GroupCase and CaseSummary satisfy it. */
export interface StoppableCase {
  id: string
  group_name: string
  student_name: string
  operations_stopped_at: string | null
  operations_stopped_by?: string | null
}

/** Everything the switch turns off, in the order a family would notice it. */
const HALTS = [
  "Queued actions — anything lined up is cancelled and nothing new sends",
  "Mentor introductions, assessments and booking links",
  "The daily mentor chase in Slack",
  "The first-class chase and the assessment-completion announcements",
  "The Stage 5 project setup — WhatsApp, Drive, SYNC and Cosmic",
  "The join and welcome check on the WhatsApp group itself",
  "The intake sheet sync for this row",
]

export function StoppedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border-destructive/30 bg-destructive/10 font-medium text-destructive",
        className,
      )}
    >
      <OctagonX className="size-3" aria-hidden="true" />
      Stopped
    </Badge>
  )
}

export function StopOperationsDialog({
  groupCase,
  open,
  onOpenChange,
  onDone,
}: {
  groupCase: StoppableCase
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const [pending, setPending] = React.useState(false)

  async function handleStop() {
    setPending(true)
    try {
      const result = await stopOperations(groupCase.id)
      if (result.already_stopped) {
        toast.info("Already stopped", {
          description: "Nothing was running for this project.",
        })
      } else {
        toast.success(`Stopped ${groupCase.group_name}`, {
          description:
            result.cancelled > 0
              ? `${result.cancelled} queued action${
                  result.cancelled === 1 ? "" : "s"
                } cancelled. No automation will touch this project again.`
              : "No automation will touch this project again.",
        })
      }
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not stop this project. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <OctagonX className="size-4" aria-hidden="true" />
            Stop all operations?
          </DialogTitle>
          <DialogDescription>
            This stops every automation for{" "}
            <span className="font-medium text-foreground">
              {groupCase.group_name}
            </span>{" "}
            ({groupCase.student_name}). It takes effect immediately and cannot
            be undone from the dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <span className="text-xs font-medium text-destructive">
            What stops
          </span>
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {HALTS.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-destructive/60">
                  —
                </span>
                <span className="text-pretty">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          Messages already sent are not affected, and the group&apos;s history
          stays on this page.
        </p>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Cancel
          </DialogClose>
          <Button variant="destructive" onClick={handleStop} disabled={pending}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <OctagonX data-icon="inline-start" />
            )}
            OK, stop everything
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The button itself. Renders nothing for a viewer: stopping is admin-only, and
 * a disabled danger button on every row is noise rather than information.
 *
 * Once stopped it becomes a plain label, because there is nothing left to do.
 */
export function StopOperationsButton({
  groupCase,
  onDone,
  size = "default",
  className,
  label = "Stop operations",
}: {
  groupCase: StoppableCase
  onDone?: () => void
  size?: "sm" | "default"
  className?: string
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  const canSend = useCanSendActions()

  if (groupCase.operations_stopped_at) {
    return <StoppedBadge className={className} />
  }
  if (!canSend) return null

  return (
    <>
      <Button
        variant="destructive"
        size={size}
        className={className}
        onClick={(e) => {
          // The list renders this inside a row that navigates on click.
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <OctagonX data-icon="inline-start" />
        {label}
      </Button>

      {/* The dialog sits outside the row's click target for the same reason. */}
      <span onClick={(e) => e.stopPropagation()}>
        <StopOperationsDialog
          groupCase={groupCase}
          open={open}
          onOpenChange={setOpen}
          onDone={onDone}
        />
      </span>
    </>
  )
}

/** The banner shown on a stopped project's page, in place of its actions. */
export function StoppedNotice({ groupCase }: { groupCase: StoppableCase }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <OctagonX
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-destructive">
          Operations stopped
        </span>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          Every automation for this project is off and nothing can be sent to
          the group. Stopped {formatDateTime(groupCase.operations_stopped_at)}
          {groupCase.operations_stopped_by
            ? ` by ${groupCase.operations_stopped_by}`
            : ""}
          . Restarting it is a deliberate change in the database, not a button
          here.
        </p>
      </div>
    </div>
  )
}
