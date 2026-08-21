"use client"

import Link from "next/link"
import {
  ArrowLeft,
  Briefcase,
  ExternalLink,
  Hash,
  Link2,
  MessageSquareText,
  Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { StageBadge } from "@/components/stage-badge"
import { CopyButton } from "@/components/copy-button"
import { ContactsPanel } from "@/components/detail/contacts-panel"
import { QueuePanel } from "@/components/detail/queue-panel"
import { Timeline } from "@/components/detail/timeline"
import { ActionsBar } from "@/components/detail/actions-bar"
import { useCase, useCaseActions, useMentors } from "@/hooks/use-data"
import { formatDate, relativeTime } from "@/lib/format"

export function DetailView({ id }: { id: string }) {
  const { data: groupCase, isLoading, mutate: mutateCase } = useCase(id)
  const {
    data: actions,
    isLoading: actionsLoading,
    mutate: mutateActions,
  } = useCaseActions(id)
  const { data: mentors } = useMentors()

  function refresh() {
    mutateCase()
    mutateActions()
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!groupCase) {
    return (
      <div className="p-4 md:p-6">
        <Empty className="min-h-[60vh]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkles />
            </EmptyMedia>
            <EmptyTitle>Group not found</EmptyTitle>
            <EmptyDescription>
              This group case doesn&apos;t exist or may have been removed.
            </EmptyDescription>
          </EmptyHeader>
          <Button render={<Link href="/" />} nativeButton={false} variant="outline">
            <ArrowLeft data-icon="inline-start" />
            Back to groups
          </Button>
        </Empty>
      </div>
    )
  }

  const meta = [
    { icon: Briefcase, label: "Project", value: groupCase.project_name },
    { icon: Hash, label: "Source", value: groupCase.source },
    {
      icon: Hash,
      label: "Sheet row",
      value: groupCase.sheet_row ? `Row ${groupCase.sheet_row}` : null,
    },
  ].filter((m) => m.value)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Button
        render={<Link href="/" />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="w-fit text-muted-foreground"
      >
        <ArrowLeft data-icon="inline-start" />
        All groups
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-pretty text-2xl font-semibold tracking-tight">
              {groupCase.group_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {groupCase.student_name}
              {groupCase.mentor_name ? ` · Mentor: ${groupCase.mentor_name}` : ""}
            </p>
          </div>
          <StageBadge stage={groupCase.stage} className="mt-1" />
        </div>

        {meta.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {meta.map((m, i) => {
              const Icon = m.icon
              return (
                <div key={i} className="flex items-center gap-1.5 text-sm">
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">{m.label}:</span>
                  <span className="font-medium">{m.value}</span>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      <Separator />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <ActionsBar
            groupCase={groupCase}
            mentors={mentors ?? []}
            onDone={refresh}
          />
          <QueuePanel groupCase={groupCase} />

          <Timeline actions={actions} isLoading={actionsLoading} />
        </div>

        <div className="flex flex-col gap-6">
          <ContactsPanel groupCase={groupCase} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Group details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <DetailRow label="Created" value={formatDate(groupCase.created_at)} />
              <DetailRow
                label="Last updated"
                value={relativeTime(groupCase.updated_at)}
              />
              <DetailRow
                label="Mentor intro"
                value={
                  groupCase.mentor_intro_sent_at
                    ? formatDate(groupCase.mentor_intro_sent_at)
                    : "Not sent"
                }
              />
              <DetailRow
                label="Nudges"
                value={
                  groupCase.nudge_count > 0
                    ? `${groupCase.nudge_count} · last ${relativeTime(groupCase.last_nudged_at)}`
                    : "None"
                }
              />
              {groupCase.invite_link ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Link2 className="size-4" aria-hidden="true" />
                    Invite link
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      render={
                        <a
                          href={groupCase.invite_link}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                      nativeButton={false}
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Open invite link"
                    >
                      <ExternalLink />
                    </Button>
                    <CopyButton value={groupCase.invite_link} label="invite link" />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
              <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="text-pretty leading-relaxed">
                All actions send a WhatsApp message to the group. Review the preview before
                confirming — messages cannot be unsent.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
