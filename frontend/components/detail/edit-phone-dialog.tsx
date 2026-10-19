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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { changePhone, type PhoneChangeResult } from "@/lib/api"
import { formatPhone } from "@/lib/format"
import type { GroupCase } from "@/lib/types"

/**
 * Correct a wrong phone number for a family.
 *
 * The number lives in two places and the backend writes them in a fixed order
 * (the queued `participants` row first, then the case) — this dialog's job is
 * to be honest about the part that isn't automatic: the new number is not
 * added to the WhatsApp group, so somebody still has to send them the invite
 * link. Saying so here is cheaper than a family who were "fixed" on the
 * dashboard and then never heard anything.
 */

export type PhoneRole = "student" | "parent"

/** What the participants row outcome means for the person who just saved. */
function participantNote(result: PhoneChangeResult): string | null {
  switch (result.participant.status) {
    case "updated":
      return "The join check is now waiting on the new number instead."
    case "already_joined":
      return "The old number is already in the WhatsApp group, so its join record was left as it is."
    case "target_exists":
      return result.participant.joined
        ? "The new number is already in the WhatsApp group."
        : "The new number was already on the group's waiting list."
    case "not_tracked":
    case "no_group_request":
    case "no_previous_number":
      // Nothing was queued on the old number, which is the ordinary case for
      // a group that has long since been welcomed. Not worth a line.
      return null
    default:
      return null
  }
}

/** SYNC is a separate project and optional, so only speak up when it matters. */
function syncNote(result: PhoneChangeResult): string | null {
  switch (result.sync.status) {
    case "taken":
      return `SYNC still has the old number: another account (${
        result.sync.name ?? "unknown"
      }) already holds the new one, so the two were not merged.`
    case "failed":
      return "SYNC could not be updated — its account still has the old number."
    case "not_found":
      return null
    default:
      return null
  }
}

export function EditPhoneDialog({
  groupCase,
  role,
  open,
  onOpenChange,
  onDone,
}: {
  groupCase: GroupCase
  role: PhoneRole
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const current =
    role === "student" ? groupCase.student_phone : groupCase.parent_phone
  const who =
    (role === "student" ? groupCase.student_name : groupCase.parent_name) ??
    (role === "student" ? "the student" : "the parent")

  const [phone, setPhone] = React.useState("")
  const [pending, setPending] = React.useState(false)

  // Re-seeded each time it opens, so a cancelled edit isn't still sitting
  // there the next time somebody opens it.
  React.useEffect(() => {
    if (open) setPhone(current ?? "")
  }, [open, current])

  const digits = phone.replace(/\D/g, "")
  const changed = digits !== (current ?? "").replace(/\D/g, "")
  const valid = digits.length >= 8 && digits.length <= 15
  const canSave = valid && changed && !pending

  async function handleSave() {
    setPending(true)
    try {
      const result = await changePhone(groupCase.id, role, digits)

      if (result.unchanged) {
        toast.info("Already that number", { description: "Nothing changed." })
      } else {
        const notes = [participantNote(result), syncNote(result)].filter(
          Boolean,
        ) as string[]
        toast.success(`${who}'s number updated`, {
          description: [
            `Now ${formatPhone(result.phone)}.`,
            ...notes,
            "They are not added to the WhatsApp group — share the invite link if they need to join.",
          ].join(" "),
        })
      }

      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not change the number. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Change {role === "student" ? "student" : "parent"} number
          </DialogTitle>
          <DialogDescription>
            Every message for {groupCase.group_name} goes to this number, and
            while the group is waiting to be joined it is the number being
            waited on. It is corrected in both places at once.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="phone-edit">Phone</FieldLabel>
          <Input
            id="phone-edit"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            placeholder="919876543210"
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) handleSave()
            }}
          />
          <FieldDescription>
            {current
              ? `Currently ${formatPhone(current)}. `
              : "No number on file. "}
            With the country code, no spaces. The new number is not added to
            the WhatsApp group — share the invite link if they still need to
            join.
          </FieldDescription>
        </Field>

        <DialogFooter showCloseButton>
          <Button onClick={handleSave} disabled={!canSave}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Check data-icon="inline-start" />
            )}
            Save number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
