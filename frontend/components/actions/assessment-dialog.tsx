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
import { formatDate } from "@/lib/format"
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

  const iso = deadline.toISOString()
  // Rendered by the backend, by the same templates that produce the real send.
  const { message, isLoading: previewLoading } = useMessagePreview(groupCase.id, {
    kind: kind === "CS" ? "CS_ASSESSMENT" : "PROTOTYPING_ASSESSMENT",
    deadline: iso,
  })

  const title = kind === "CS" ? "Send CS assessment" : "Send Prototyping assessment"

  async function handleSend() {
    setPending(true)
    try {
      const actor = await authorizeSend()
      if (kind === "CS") await sendCsAssessment(groupCase.id, iso, actor)
      else await sendPrototypingAssessment(groupCase.id, iso, actor)
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
              {formatDate(iso)}
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
