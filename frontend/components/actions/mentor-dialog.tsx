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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { WhatsappPreview } from "@/components/whatsapp-preview"
import { addMentor, queueAction } from "@/lib/api"
import { authorizeSend } from "@/lib/authorize-send"
import type { GroupCase, Mentor } from "@/lib/types"

const DEFAULT_VARIANT = "__default__"

export function MentorDialog({
  groupCase,
  mentors,
  open,
  onOpenChange,
  onDone,
}: {
  groupCase: GroupCase
  mentors: Mentor[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const [mentorName, setMentorName] = React.useState<string | null>(null)
  const [variant, setVariant] = React.useState<string>(DEFAULT_VARIANT)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setMentorName(null)
      setVariant(DEFAULT_VARIANT)
    }
  }, [open])

  const mentor = mentors.find((m) => m.name === mentorName) ?? null
  const variantKeys = mentor?.variants ? Object.keys(mentor.variants) : []

  React.useEffect(() => {
    setVariant(DEFAULT_VARIANT)
  }, [mentorName])

  const message =
    mentor
      ? variant !== DEFAULT_VARIANT && mentor.variants?.[variant]
        ? mentor.variants[variant]
        : mentor.intro
      : ""

  /**
   * Nobody is in the group yet, so this is queued rather than sent. The runner
   * sends it, in order with anything else queued, once the welcome goes out.
   */
  const queueing = groupCase.stage === "AWAITING_JOIN"

  async function handleSend() {
    if (!mentor) return
    setPending(true)
    try {
      if (queueing) {
        await queueAction(groupCase.id, {
          kind: "ADD_MENTOR",
          mentor: mentor.name,
          ...(variant !== DEFAULT_VARIANT ? { variant } : {}),
        })
        toast.success("Mentor introduction queued", {
          description: `${mentor.name} will be introduced once the family joins ${groupCase.group_name}.`,
        })
        onOpenChange(false)
        onDone?.()
        return
      }

      const actor = await authorizeSend()
      const result = await addMentor(
        groupCase.id,
        mentor.name,
        variant !== DEFAULT_VARIANT ? variant : undefined,
        actor,
      )

      // The introduction now waits for the mentor to be in the group. When it
      // is held, saying "introduced" would be a lie -- the family has heard
      // nothing yet, and the five-minute job is what eventually sends it.
      const held = Boolean(
        (result.action?.detail as { held?: boolean } | null | undefined)?.held,
      )
      if (held) {
        toast.success("Mentor assigned, introduction held", {
          description: `${mentor.name} has been sent the group link. The introduction goes out once they join ${groupCase.group_name}.`,
        })
      } else {
        toast.success("Mentor introduced", {
          description: `${mentor.name} was introduced to ${groupCase.group_name}.`,
        })
      }
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not introduce the mentor. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{queueing ? "Queue a mentor introduction" : "Introduce a mentor"}</DialogTitle>
          <DialogDescription>
            {queueing
              ? `Pick a mentor and, if available, a subject-specific introduction. Nobody has joined ${groupCase.group_name} yet, so it will be queued and sent once the welcome goes out.`
              : `Pick a mentor and, if available, a subject-specific introduction to send to ${groupCase.group_name}.`}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel>Mentor</FieldLabel>
          <Select
            value={mentorName ?? undefined}
            onValueChange={(v) => setMentorName(v as string)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a mentor" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {mentors.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        {variantKeys.length > 0 ? (
          <Field>
            <FieldLabel>Introduction variant</FieldLabel>
            <ToggleGroup
              value={[variant]}
              onValueChange={(value) => {
                const next = value[0]
                if (next) setVariant(next)
              }}
              className="flex-wrap"
            >
              <ToggleGroupItem value={DEFAULT_VARIANT} className="text-xs capitalize">
                General
              </ToggleGroupItem>
              {variantKeys.map((k) => (
                <ToggleGroupItem key={k} value={k} className="text-xs capitalize">
                  {k}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              Subject-specific intros are tailored to the group&apos;s project area.
            </FieldDescription>
          </Field>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Message preview</span>
          {mentor ? (
            <WhatsappPreview message={message} groupName={groupCase.group_name} />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Select a mentor to preview the introduction.
            </div>
          )}
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleSend} disabled={pending || !mentor}>
            {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            {queueing ? "Add to queue" : "Send introduction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
