"use client"

import * as React from "react"
import { MailWarning, Pencil, Plus, SearchIcon, UsersRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { AddMentorDialog } from "@/components/mentors/add-mentor-dialog"
import { EditMentorDialog } from "@/components/mentors/edit-mentor-dialog"
import { useCanSendActions } from "@/components/auth/auth-provider"
import { useMentors } from "@/hooks/use-data"
import type { Mentor } from "@/lib/types"

function initials(name: string): string {
  const parts = name.replace(/^(Dr\.?|Prof\.?)\s+/i, "").split(/\s+/)
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
}

export function MentorsView() {
  const { data: mentors, isLoading, mutate } = useMentors()
  const [query, setQuery] = React.useState("")
  const [addOpen, setAddOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Mentor | null>(null)
  const canManage = useCanSendActions()

  // Mentors the intake sheet cannot name. The sheet identifies a mentor by an
  // exact email match, so an entry without one is invisible to it however well
  // its name is spelt -- worth surfacing as a job to do rather than leaving to
  // be discovered as a Slack alert on somebody's group.
  const missingEmail = (mentors ?? []).filter((m) => !(m.email ?? "").trim())

  const filtered = React.useMemo(() => {
    if (!mentors) return []
    const q = query.trim().toLowerCase()
    if (!q) return mentors
    return mentors.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.intro.toLowerCase().includes(q),
    )
  }, [mentors, query])

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Mentors</h1>
          <p className="text-sm text-muted-foreground">
            The mentor roster used when introducing groups. Each intro is sent verbatim
            over WhatsApp.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setAddOpen(true)}>
            <Plus data-icon="inline-start" />
            Add mentor
          </Button>
        ) : null}
      </div>

      {missingEmail.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <MailWarning
            className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
            aria-hidden="true"
          />
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {missingEmail.length} mentor{missingEmail.length === 1 ? " has" : "s have"} no
              email
            </span>{" "}
            and cannot be named from the intake sheet, which identifies a mentor
            by an exact email match. Add their addresses to line those rows up.
          </p>
        </div>
      ) : null}

      <InputGroup className="max-w-sm">
        <InputGroupInput
          placeholder="Search mentors..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>

      <AddMentorDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={() => mutate()}
      />

      <EditMentorDialog
        mentor={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onDone={() => mutate()}
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="min-h-[40vh]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRound />
            </EmptyMedia>
            <EmptyTitle>No mentors found</EmptyTitle>
            <EmptyDescription>
              No mentors match &ldquo;{query}&rdquo;. Try a different search.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m) => (
            <MentorCard
              key={m.name}
              mentor={m}
              onEdit={canManage ? () => setEditing(m) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MentorCard({
  mentor,
  onEdit,
}: {
  mentor: Mentor
  /** Omitted for viewers, who cannot change what the team sends. */
  onEdit?: () => void
}) {
  const variants = mentor.variants ? Object.keys(mentor.variants) : []
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarFallback className="bg-brand/10 text-sm font-medium text-brand">
              {initials(mentor.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-medium leading-tight">{mentor.name}</span>
            <span className="text-xs text-muted-foreground">
              {variants.length > 0
                ? `${variants.length + 1} intro variant${variants.length > 0 ? "s" : ""}`
                : "1 intro"}
            </span>
            {!(mentor.email ?? "").trim() ? (
              <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                <MailWarning className="size-3" aria-hidden="true" />
                No email — not nameable from the sheet
              </span>
            ) : null}
          </div>
          {onEdit ? (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              onClick={onEdit}
              aria-label={`Edit ${mentor.name}`}
            >
              <Pencil />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
          {mentor.intro}
        </p>
        {variants.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="capitalize">
              General
            </Badge>
            {variants.map((v) => (
              <Badge key={v} variant="outline" className="capitalize">
                {v}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
