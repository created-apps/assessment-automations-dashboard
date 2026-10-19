"use client"

import * as React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/copy-button"
import { useCanSendActions } from "@/components/auth/auth-provider"
import {
  EditPhoneDialog,
  type PhoneRole,
} from "@/components/detail/edit-phone-dialog"
import type { GroupCase } from "@/lib/types"
import { formatPhone } from "@/lib/format"
import { GraduationCap, Mail, Pencil, Phone, Plus, Users } from "lucide-react"

type Contact = {
  role: PhoneRole
  label: string
  name: string | null
  phone: string | null
  email: string | null
  icon: typeof GraduationCap
}

export function ContactsPanel({
  groupCase,
  onDone,
}: {
  groupCase: GroupCase
  /** Called after a number changes, so the case is re-read. */
  onDone?: () => void
}) {
  // Correcting a number repoints the automations, so it is held to the same
  // bar as sending: admins only. The route enforces it regardless.
  const canEdit = useCanSendActions()
  const [editing, setEditing] = React.useState<PhoneRole | null>(null)

  const contacts: Contact[] = ([
    {
      role: "student",
      label: "Student",
      name: groupCase.student_name,
      phone: groupCase.student_phone,
      email: groupCase.student_email,
      icon: GraduationCap,
    },
    {
      role: "parent",
      label: "Parent",
      name: groupCase.parent_name,
      phone: groupCase.parent_phone,
      email: groupCase.parent_email,
      icon: Users,
    },
  ] satisfies Contact[]).filter((c) => c.name || c.phone || c.email)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contacts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {contacts.map((c, i) => {
          const Icon = c.icon
          return (
            <div key={c.role} className="flex flex-col gap-3">
              {i > 0 ? <Separator /> : null}
              <div className="flex items-center gap-2">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{c.name ?? "Unknown"}</span>
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                </div>
              </div>
              {c.phone ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm tabular-nums">
                    <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
                    {formatPhone(c.phone)}
                  </div>
                  <div className="flex items-center gap-1">
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Change ${c.label.toLowerCase()} phone number`}
                        onClick={() => setEditing(c.role)}
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                    <CopyButton value={c.phone} label="phone number" />
                  </div>
                </div>
              ) : canEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit text-muted-foreground"
                  onClick={() => setEditing(c.role)}
                >
                  <Plus data-icon="inline-start" />
                  Add {c.label.toLowerCase()} number
                </Button>
              ) : null}
              {c.email ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{c.email}</span>
                  </div>
                  <CopyButton value={c.email} label="email" />
                </div>
              ) : null}
            </div>
          )
        })}
      </CardContent>

      {editing ? (
        <EditPhoneDialog
          groupCase={groupCase}
          role={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onDone={onDone}
        />
      ) : null}
    </Card>
  )
}
