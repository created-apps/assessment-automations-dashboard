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

/**
 * The default `intro`, as a pickable option. Not sent to the server — it means
 * "no variant", which is what makes the backend use the default wording.
 */
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
  /**
   * Null means "not chosen yet". A mentor with more than one introduction has
   * to be given an explicit choice -- preselecting the default is how somebody
   * sends the general wording to a family who should have had the
   * subject-specific one, without ever noticing it existed.
   */
  const [variant, setVariant] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setMentorName(null)
      setVariant(null)
    }
  }, [open])

  const mentor = mentors.find((m) => m.name === mentorName) ?? null
  const variantKeys = mentor?.variants ? Object.keys(mentor.variants) : []
  /** With only the default wording there is nothing to choose between. */
  const mustChoose = variantKeys.length > 0
  const chosen = mustChoose ? variant : DEFAULT_VARIANT

  React.useEffect(() => {
    setVariant(null)
  }, [mentorName])

  const message =
    mentor && chosen
      ? chosen !== DEFAULT_VARIANT && mentor.variants?.[chosen]
        ? mentor.variants[chosen]
        : mentor.intro
      : ""

  /**
   * Nobody is in the group yet, so this is queued rather than sent. The runner
   * sends it, in order with anything else queued, once the welcome goes out.
   */
  const queueing = groupCase.stage === "AWAITING_JOIN"

  async function handleSend() {
    if (!mentor || !chosen) return
    setPending(true)
    try {
      if (queueing) {
        await queueAction(groupCase.id, {
          kind: "ADD_MENTOR",
          mentor: mentor.name,
          ...(chosen !== DEFAULT_VARIANT ? { variant: chosen } : {}),
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
        chosen !== DEFAULT_VARIANT ? chosen : undefined,
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

        {mustChoose ? (
          <Field>
            <FieldLabel>
              Which introduction?{" "}
              <span className="font-normal text-muted-foreground">(required)</span>
            </FieldLabel>
            <ToggleGroup
              value={variant ? [variant] : []}
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
              {mentor?.name} has {variantKeys.length + 1} introductions. Pick the
              one that fits this group&apos;s project — nothing is preselected,
              so the general wording can&apos;t go out by accident.
            </FieldDescription>
          </Field>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Message preview</span>
          {mentor && chosen ? (
            <WhatsappPreview message={message} groupName={groupCase.group_name} />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {mentor
                ? "Pick an introduction to preview it."
                : "Select a mentor to preview the introduction."}
            </div>
          )}
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleSend} disabled={pending || !mentor || !chosen}>
            {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            {queueing ? "Add to queue" : "Send introduction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
