"use client"

import * as React from "react"
import { CalendarClock, Code2, Lightbulb, Rocket, UserPlus } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AssessmentDialog } from "@/components/actions/assessment-dialog"
import { MeetingDialog } from "@/components/actions/meeting-dialog"
import { MentorDialog } from "@/components/actions/mentor-dialog"
import { ProjectSetupDialog } from "@/components/actions/project-setup-dialog"
import { useCanSendActions } from "@/components/auth/auth-provider"
import { StoppedBadge } from "@/components/stop-operations"
import type { GroupCase, Mentor } from "@/lib/types"

type ActionId = "cs" | "prototyping" | "meeting" | "mentor" | "project-setup" | null

export function ActionsBar({
  groupCase,
  mentors,
  onDone,
}: {
  groupCase: GroupCase
  mentors: Mentor[]
  onDone: () => void
}) {
  const [active, setActive] = React.useState<ActionId>(null)
  const close = () => setActive(null)
  // Stopping is permanent, so the buttons go dead rather than failing on the
  // server. The server refuses these anyway -- this is so nobody composes a
  // message for a family that was never going to receive it.
  const stopped = Boolean(groupCase.operations_stopped_at)
  const canSend = useCanSendActions() && !stopped

  const actions = [
    {
      id: "cs" as const,
      label: "CS assessment",
      description: "Send the Computer Science task",
      icon: Code2,
    },
    {
      id: "prototyping" as const,
      label: "Prototyping",
      description: "Send the Prototyping task",
      icon: Lightbulb,
    },
    {
      id: "meeting" as const,
      label: "Booking link",
      description: "Send a call scheduling link",
      icon: CalendarClock,
    },
    {
      id: "mentor" as const,
      label: "Introduce mentor",
      description: "Assign and introduce a mentor",
      icon: UserPlus,
    },
    {
      id: "project-setup" as const,
      label: "Project setup",
      description: "Queue the Stage 5 automation",
      icon: Rocket,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Actions
          {stopped ? (
            <StoppedBadge />
          ) : !canSend ? (
            <Badge variant="secondary" className="font-normal">
              Read-only
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {actions.map((a) => {
          const Icon = a.icon
          const button = (
            <Button
              variant="outline"
              className="h-auto w-full flex-col items-start gap-1 p-3 text-left"
              onClick={() => setActive(a.id)}
              disabled={!canSend}
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {a.label}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {a.description}
              </span>
            </Button>
          )

          if (canSend) {
            return <React.Fragment key={a.id}>{button}</React.Fragment>
          }

          return (
            <Tooltip key={a.id}>
              <TooltipTrigger render={<span className="flex" />}>
                {button}
              </TooltipTrigger>
              <TooltipContent>
                {stopped
                  ? "Operations are stopped for this project"
                  : "Read-only access — ask an admin to send this"}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </CardContent>

      <AssessmentDialog
        kind="CS"
        groupCase={groupCase}
        open={active === "cs"}
        onOpenChange={(o) => (o ? setActive("cs") : close())}
        onDone={onDone}
      />
      <AssessmentDialog
        kind="PROTOTYPING"
        groupCase={groupCase}
        open={active === "prototyping"}
        onOpenChange={(o) => (o ? setActive("prototyping") : close())}
        onDone={onDone}
      />
      <MeetingDialog
        groupCase={groupCase}
        open={active === "meeting"}
        onOpenChange={(o) => (o ? setActive("meeting") : close())}
        onDone={onDone}
      />
      <MentorDialog
        groupCase={groupCase}
        mentors={mentors}
        open={active === "mentor"}
        onOpenChange={(o) => (o ? setActive("mentor") : close())}
        onDone={onDone}
      />
      <ProjectSetupDialog
        groupCase={groupCase}
        open={active === "project-setup"}
        onOpenChange={(o) => (o ? setActive("project-setup") : close())}
        onDone={onDone}
      />
    </Card>
  )
}
