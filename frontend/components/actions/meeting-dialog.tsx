"use client"

import * as React from "react"
import { toast } from "sonner"
import { SendIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { WhatsappPreview } from "@/components/whatsapp-preview"
import { useMessagePreview } from "@/lib/messages"
import { queueAction, scheduleMeeting } from "@/lib/api"
import { authorizeSend } from "@/lib/authorize-send"
import type { GroupCase, MeetingHost } from "@/lib/types"

const HOSTS: MeetingHost[] = ["Aashna Saraf", "Urja Jhaveri", "Dhruv Singh"]

export function MeetingDialog({
  groupCase,
  open,
  onOpenChange,
  onDone,
}: {
  groupCase: GroupCase
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const [host, setHost] = React.useState<MeetingHost>(HOSTS[0])
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) setHost(HOSTS[0])
  }, [open])

  // Rendered by the backend: the booking URL lives in its config, not here.
  const { message, isLoading: previewLoading } = useMessagePreview(groupCase.id, {
    kind: "SCHEDULE_MEETING",
    host,
  })

  /**
   * Nobody is in the group yet, so this is queued rather than sent. The runner
   * sends it, in order with anything else queued, once the welcome goes out.
   */
  const queueing = groupCase.stage === "AWAITING_JOIN"

  async function handleSend() {
    setPending(true)
    try {
      if (queueing) {
        await queueAction(groupCase.id, { kind: "SCHEDULE_MEETING", host })
        toast.success("Booking link queued", {
          description: `It will send once ${groupCase.student_name} joins the group.`,
        })
        onOpenChange(false)
        onDone?.()
        return
      }

      const actor = await authorizeSend()
      await scheduleMeeting(groupCase.id, host, actor)
      toast.success("Booking link sent", {
        description: `${host} will host the call with ${groupCase.student_name}.`,
      })
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not send the booking link. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send booking link</DialogTitle>
          <DialogDescription>
            Choose who will host the intro call, then send the scheduling link to{" "}
            {groupCase.group_name}.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel>Meeting host</FieldLabel>
          <ToggleGroup
            value={[host]}
            onValueChange={(value) => {
              const next = value[0] as MeetingHost | undefined
              if (next) setHost(next)
            }}
            className="w-full"
          >
            {HOSTS.map((h) => (
              <ToggleGroupItem key={h} value={h} className="flex-1 text-xs">
                {h.split(" ")[0]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Message preview</span>
          <WhatsappPreview message={message ?? ""} groupName={groupCase.group_name} />
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleSend} disabled={pending || previewLoading || !message}>
            {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            {queueing ? "Add to queue" : "Send message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
