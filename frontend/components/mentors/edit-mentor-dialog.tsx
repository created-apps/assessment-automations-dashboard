"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { updateMentorIntro } from "@/lib/api"
import type { Mentor } from "@/lib/types"

/**
 * Reword a mentor's introduction. Open when `mentor` is set; the name is fixed,
 * because it is what every other part of the system matches them on.
 */
export function EditMentorDialog({
  mentor,
  onOpenChange,
  onDone,
}: {
  mentor: Mentor | null
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const [intro, setIntro] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (mentor) setIntro(mentor.intro)
  }, [mentor])

  const trimmed = intro.trim()
  const canSave =
    Boolean(mentor) && trimmed.length > 0 && trimmed !== mentor?.intro.trim() && !pending

  async function handleSave() {
    if (!mentor || !trimmed) return
    setPending(true)
    try {
      await updateMentorIntro(mentor.name, trimmed)
      toast.success("Introduction updated", {
        description: `${mentor.name}'s introduction has changed for everyone.`,
      })
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not save the introduction. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={Boolean(mentor)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit introduction</DialogTitle>
          <DialogDescription>
            {mentor
              ? `Changes what is sent when ${mentor.name} is introduced to a group. It takes effect immediately, for everyone.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="m-edit-intro">Introduction message</FieldLabel>
          <Textarea
            id="m-edit-intro"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={10}
          />
          <FieldDescription>Sent as-is into the WhatsApp group.</FieldDescription>
        </Field>

        <DialogFooter showCloseButton>
          <Button onClick={handleSave} disabled={!canSave}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Check data-icon="inline-start" />
            )}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
