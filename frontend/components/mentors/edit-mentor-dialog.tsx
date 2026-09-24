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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { updateMentor, type MentorEdit } from "@/lib/api"
import type { Mentor } from "@/lib/types"

/**
 * Edit a mentor. Open when `mentor` is set; the name is fixed, because it is
 * what every other part of the system matches them on.
 *
 * Only changed fields are sent, so saving an introduction never quietly
 * rewrites contact details somebody else corrected in the meantime.
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
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (!mentor) return
    setIntro(mentor.intro)
    setEmail(mentor.email ?? "")
    setPhone(mentor.phone ?? "")
  }, [mentor])

  const trimmedIntro = intro.trim()
  const trimmedEmail = email.trim()
  const trimmedPhone = phone.trim()

  /** Only what actually changed. Empty clears the field rather than skipping it. */
  const changes: MentorEdit = React.useMemo(() => {
    if (!mentor) return {}
    const out: MentorEdit = {}
    if (trimmedIntro && trimmedIntro !== mentor.intro.trim()) {
      out.intro = trimmedIntro
    }
    if (trimmedEmail !== (mentor.email ?? "").trim()) {
      out.email = trimmedEmail || null
    }
    if (trimmedPhone !== (mentor.phone ?? "").trim()) {
      out.phone = trimmedPhone || null
    }
    return out
  }, [mentor, trimmedIntro, trimmedEmail, trimmedPhone])

  const canSave =
    Boolean(mentor) && Object.keys(changes).length > 0 && !pending && Boolean(trimmedIntro)

  async function handleSave() {
    if (!mentor || Object.keys(changes).length === 0) return
    setPending(true)
    try {
      await updateMentor(mentor.name, changes)
      toast.success("Mentor updated", {
        description: `${mentor.name}'s details have changed for everyone.`,
      })
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not save the changes. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={Boolean(mentor)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit mentor</DialogTitle>
          <DialogDescription>
            {mentor
              ? `Changes what is sent when ${mentor.name} is introduced, and how they are identified. It takes effect immediately, for everyone.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="m-edit-email">Email</FieldLabel>
          <Input
            id="m-edit-email"
            type="email"
            value={email}
            placeholder="name@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldDescription>
            How the intake sheet identifies this mentor — matched exactly. A
            mentor with no email here cannot be named from the sheet at all.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="m-edit-phone">Phone</FieldLabel>
          <Input
            id="m-edit-phone"
            value={phone}
            placeholder="919876543210"
            onChange={(e) => setPhone(e.target.value)}
          />
          <FieldDescription>
            Receives the group invite, and links them to their SYNC account.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="m-edit-intro">Introduction message</FieldLabel>
          <Textarea
            id="m-edit-intro"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={8}
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
