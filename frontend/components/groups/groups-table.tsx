"use client"

import { useRouter } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { StageBadge } from "@/components/stage-badge"
import { StopOperationsButton } from "@/components/stop-operations"
import { ACTION_SHORT, daysSince, relativeTime } from "@/lib/format"
import type { CaseSummary } from "@/lib/types"

function OpenFor({ row }: { row: CaseSummary }) {
  const days = daysSince(row.created_at)
  const overdue = days > 14 && row.stage !== "MENTOR_ASSIGNED"
  return (
    <span
      className={cn(
        "tabular-nums",
        overdue ? "font-semibold text-destructive" : "text-muted-foreground",
      )}
    >
      {days === 0 ? "today" : `${days}d`}
    </span>
  )
}

function LastAction({ row }: { row: CaseSummary }) {
  if (!row.last_action_kind || !row.last_action_at) {
    return <span className="text-muted-foreground/70">none yet</span>
  }
  return (
    <span className="text-muted-foreground">
      {ACTION_SHORT[row.last_action_kind]}
      <span className="text-muted-foreground/60">
        {" · "}
        {relativeTime(row.last_action_at)}
      </span>
    </span>
  )
}

function Nudges({ row }: { row: CaseSummary }) {
  if (row.nudge_count === 0) {
    return <span className="tabular-nums text-muted-foreground/70">0</span>
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="cursor-default tabular-nums text-muted-foreground" />
        }
      >
        {row.nudge_count}
      </TooltipTrigger>
      <TooltipContent>
        Last nudged {relativeTime(row.last_nudged_at)}
      </TooltipContent>
    </Tooltip>
  )
}

function Mentor({ row }: { row: CaseSummary }) {
  if (row.mentor_name) {
    return <span className="text-foreground">{row.mentor_name}</span>
  }
  return (
    <span className="text-muted-foreground/70">
      — <span className="text-xs">not assigned</span>
    </span>
  )
}

export function GroupsTable({
  rows,
  onChanged,
}: {
  rows: CaseSummary[]
  /** Re-fetch the list after a row is stopped, so it repaints as stopped. */
  onChanged?: () => void
}) {
  const router = useRouter()

  function open(id: string) {
    router.push(`/groups/${id}`)
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-56">Student</TableHead>
              <TableHead className="w-40">Stage</TableHead>
              <TableHead className="min-w-40">Mentor</TableHead>
              <TableHead className="min-w-44">Last action</TableHead>
              <TableHead className="w-24">Open for</TableHead>
              <TableHead className="w-20 text-right">Nudges</TableHead>
              <TableHead className="w-32" />
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const stopped = Boolean(row.operations_stopped_at)
              // A stopped row is not "new" any more, whatever its stage says:
              // the amber flag means someone should act on it, and nobody can.
              const isNew = row.stage === "NEW" && !stopped
              return (
                <TableRow
                  key={row.id}
                  onClick={() => open(row.id)}
                  className={cn(
                    "group cursor-pointer",
                    isNew && "bg-amber-500/[0.04] hover:bg-amber-500/[0.08]",
                    stopped && "opacity-60",
                  )}
                >
                  <TableCell
                    className={cn(
                      "relative",
                      isNew &&
                        "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-amber-500",
                    )}
                  >
                    <div className="font-semibold">{row.student_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {row.project_name ?? "No project name"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={row.stage} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <Mentor row={row} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <LastAction row={row} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <OpenFor row={row} />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <Nudges row={row} />
                  </TableCell>
                  <TableCell className="text-right">
                    <StopOperationsButton
                      groupCase={row}
                      size="sm"
                      label="Stop"
                      onDone={onChanged}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground/50">
                    <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => {
          const stopped = Boolean(row.operations_stopped_at)
          const isNew = row.stage === "NEW" && !stopped
          return (
            // A div, not a button: the stop control is itself a button, and a
            // button inside a button is invalid and swallows the inner click.
            <div
              key={row.id}
              role="link"
              tabIndex={0}
              onClick={() => open(row.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  open(row.id)
                }
              }}
              className={cn(
                "flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                isNew && "border-l-2 border-l-amber-500",
                stopped && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{row.student_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {row.project_name ?? "No project name"}
                  </div>
                </div>
                <StageBadge stage={row.stage} />
              </div>
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-muted-foreground">Mentor</div>
                <div className="text-right">
                  <Mentor row={row} />
                </div>
                <div className="text-muted-foreground">Last action</div>
                <div className="text-right">
                  <LastAction row={row} />
                </div>
                <div className="text-muted-foreground">Open for</div>
                <div className="text-right">
                  <OpenFor row={row} />
                </div>
                <div className="text-muted-foreground">Nudges</div>
                <div className="text-right">
                  <Nudges row={row} />
                </div>
              </div>
              <div className="flex justify-end">
                <StopOperationsButton
                  groupCase={row}
                  size="sm"
                  onDone={onChanged}
                />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
