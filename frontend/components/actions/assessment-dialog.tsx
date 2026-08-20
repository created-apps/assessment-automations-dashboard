"use client"

import * as React from "react"
import { toast } from "sonner"
import { CalendarIcon, SendIcon } from "lucide-react"

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
import { Spinner } from "@/components/ui/spinner"
import { WhatsappPreview } from "@/components/whatsapp-preview"
import { useMessagePreview } from "@/lib/messages"
import { sendCsAssessment, sendPrototypingAssessment } from "@/lib/api"
import { authorizeSend } from "@/lib/authorize-send"
import type { GroupCase } from "@/lib/types"
import { cn } from "@/lib/utils"

type Kind = "CS" | "PROTOTYPING"

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
  const [calendarOpen, setCalendarOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) setDeadline(defaultDeadline())
  }, [open])

  const deadlineDate = toLocalDate(deadline)
  // Rendered by the backend, by the same templates that produce the real send.
  const { message, isLoading: previewLoading } = useMessagePreview(groupCase.id, {
    kind: kind === "CS" ? "CS_ASSESSMENT" : "PROTOTYPING_ASSESSMENT",
    deadline: deadlineDate,
  })

  const title = kind === "CS" ? "Send CS assessment" : "Send Prototyping assessment"

  async function handleSend() {
    setPending(true)
    try {
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
            Set a deadline, review the exact message, then send it to {groupCase.group_name}.
          </DialogDescription>
        </DialogHeader>

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

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Message preview</span>
          <WhatsappPreview message={message ?? ""} groupName={groupCase.group_name} />
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleSend} disabled={pending || previewLoading || !message}>
            {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            Send message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
