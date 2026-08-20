"use client"

import * as React from "react"
import { toast } from "sonner"
import { UserPlus } from "lucide-react"

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
import { createMentor } from "@/lib/api"

export function AddMentorDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const [name, setName] = React.useState("")
  const [intro, setIntro] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName("")
      setIntro("")
      setEmail("")
      setPhone("")
    }
  }, [open])

  // Phone is required: it is what the mentor's SYNC account is keyed on, and
  // where their group invite link is sent. Without it they can be introduced
  // but never linked to a group, a Drive folder or a COSMIC project.
  const canSave =
    name.trim().length > 0 &&
    intro.trim().length > 0 &&
    phone.trim().length > 0 &&
    !pending

  async function handleSave() {
    if (!name.trim() || !intro.trim() || !phone.trim()) return
    setPending(true)
    try {
      await createMentor({
        name: name.trim(),
        intro: intro.trim(),
        email: email.trim() || undefined,
        phone: phone.trim(),
      })
      toast.success("Mentor added", {
        description: `${name.trim()} is now in the directory.`,
      })
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not add the mentor. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a mentor</DialogTitle>
          <DialogDescription>
            Adds a mentor to the directory. The introduction is sent verbatim
            over WhatsApp when this mentor is introduced to a group.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="m-name">Name</FieldLabel>
          <Input
            id="m-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dr. Nirupma Singh"
          />
          <FieldDescription>
            Use the mentor&apos;s exact name as it appears in SYNC, so Stage 5
            can link them automatically.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="m-intro">Introduction message</FieldLabel>
          <Textarea
            id="m-intro"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            placeholder="I would like to introduce you to your research mentor..."
            rows={6}
          />
          <FieldDescription>Sent as-is into the WhatsApp group.</FieldDescription>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="m-email">Email</FieldLabel>
            <Input
              id="m-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mentor@example.com"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="m-phone">Phone (required)</FieldLabel>
            <Input
              id="m-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91…"
            />
          </Field>
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleSave} disabled={!canSave}>
            {pending ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
            Add mentor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
