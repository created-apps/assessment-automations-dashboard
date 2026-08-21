"use client"

import * as React from "react"
import { toast } from "sonner"
import { CalendarIcon, ListPlus, SendIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { WhatsappPreview } from "@/components/whatsapp-preview"
import { useMessagePreview } from "@/lib/messages"
import { queueAction, sendCsAssessment, sendPrototypingAssessment } from "@/lib/api"
import { authorizeSend } from "@/lib/authorize-send"
import type { GroupCase } from "@/lib/types"
import { cn } from "@/lib/utils"

type Kind = "CS" | "PROTOTYPING"

/** The default window, in days. Used directly when queuing. */
const DEFAULT_DEADLINE_DAYS = 7

function defaultDeadline(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d
}

/**
 * The picked day as YYYY-MM-DD, read off the LOCAL calendar.
 *
 * Not toISOString(): that converts to UTC first, so any local time before the
 * UTC offset rolls the date back a day. In IST a deadline picked for the 28th
 * became "2026-08-27T20:52:33.131Z" and the family was told the 27th. A
 * deadline is a calendar day, not an instant, so no timezone belongs in it.
 */
function toLocalDate(d: Date): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  )
}

export function AssessmentDialog({
  kind,
  groupCase,
  open,
  onOpenChange,
  onDone,
}: {
  kind: Kind
  groupCase: GroupCase
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const [deadline, setDeadline] = React.useState<Date>(defaultDeadline)
  const [days, setDays] = React.useState(String(DEFAULT_DEADLINE_DAYS))
  const [calendarOpen, setCalendarOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setDeadline(defaultDeadline())
      setDays(String(DEFAULT_DEADLINE_DAYS))
    }
  }, [open])

  /**
   * Nobody is in the group yet, so this is queued rather than sent, and the
   * deadline is a number of days rather than a date -- the queue can wait days
   * on a family joining, and the date is worked out when it actually sends.
   */
  const queueing = groupCase.stage === "AWAITING_JOIN"
  const dayCount = Number(days)
  const daysValid = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 365

  // The preview always needs a concrete date. When queuing, show the date that
  // sending today would produce -- honest about the wording, and the real one
  // is computed the same way at send time.
  const previewFrom = React.useMemo(() => {
    if (!queueing) return deadline
    const d = new Date()
    d.setDate(d.getDate() + (daysValid ? dayCount : DEFAULT_DEADLINE_DAYS))
    return d
  }, [queueing, deadline, daysValid, dayCount])

  const deadlineDate = toLocalDate(previewFrom)
  // Rendered by the backend, by the same templates that produce the real send.
  const { message, isLoading: previewLoading } = useMessagePreview(groupCase.id, {
    kind: kind === "CS" ? "CS_ASSESSMENT" : "PROTOTYPING_ASSESSMENT",
    deadline: deadlineDate,
  })

  const noun = kind === "CS" ? "CS assessment" : "Prototyping assessment"
  const title = queueing ? `Queue ${noun}` : `Send ${noun}`

  async function handleSend() {
    setPending(true)
    try {
      if (queueing) {
        await queueAction(groupCase.id, {
          kind: kind === "CS" ? "CS_ASSESSMENT" : "PROTOTYPING_ASSESSMENT",
          deadline_days: dayCount,
        })
        toast.success("Assessment queued", {
          description: `It will send once ${groupCase.student_name} joins the group, with a ${dayCount}-day deadline from that moment.`,
        })
        onOpenChange(false)
        onDone?.()
        return
      }

      const actor = await authorizeSend()
      if (kind === "CS") await sendCsAssessment(groupCase.id, deadlineDate, actor)
      else await sendPrototypingAssessment(groupCase.id, deadlineDate, actor)
      toast.success("Assessment sent", {
        description: `${groupCase.student_name} will receive it on WhatsApp.`,
      })
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not send the assessment. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {queueing
              ? `Nobody has joined ${groupCase.group_name} yet. This will be queued and sent in order once the welcome message goes out.`
              : `Set a deadline, review the exact message, then send it to ${groupCase.group_name}.`}
          </DialogDescription>
        </DialogHeader>

        {queueing ? (
          <Field>
            <FieldLabel htmlFor="a-days">Deadline, in days from sending</FieldLabel>
            <Input
              id="a-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Counted from the day it actually sends, not today, so a family who
              takes a while to join still gets the full window.
            </span>
          </Field>
        ) : (
        <Field>
          <FieldLabel>Submission deadline</FieldLabel>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className={cn("justify-start font-normal", !deadline && "text-muted-foreground")}
                />
              }
            >
              <CalendarIcon data-icon="inline-start" />
              {deadline.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={deadline}
                onSelect={(d) => {
                  if (d) setDeadline(d)
                  setCalendarOpen(false)
                }}
                disabled={{ before: new Date() }}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </Field>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Message preview{queueing ? " (as it would read if sent today)" : ""}
          </span>
          <WhatsappPreview message={message ?? ""} groupName={groupCase.group_name} />
        </div>

        <DialogFooter showCloseButton>
          <Button
            onClick={handleSend}
            disabled={pending || previewLoading || !message || (queueing && !daysValid)}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : queueing ? (
              <ListPlus data-icon="inline-start" />
            ) : (
              <SendIcon data-icon="inline-start" />
            )}
            {queueing ? "Add to queue" : "Send message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
