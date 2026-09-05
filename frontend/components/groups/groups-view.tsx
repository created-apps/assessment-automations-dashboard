"use client"

import * as React from "react"
import { SearchIcon, InboxIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { StatTiles } from "@/components/groups/stat-tiles"
import { GroupsTable } from "@/components/groups/groups-table"
import { useCases } from "@/hooks/use-data"
import { STAGE_LABELS, daysSince } from "@/lib/format"
import type { CaseSummary, Stage } from "@/lib/types"

type Filter = Stage | "ALL"
type Sort = "newest" | "oldest" | "longest"

const CHIPS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "AWAITING_JOIN", label: STAGE_LABELS.AWAITING_JOIN },
  { key: "NEW", label: STAGE_LABELS.NEW },
  { key: "IN_PROGRESS", label: STAGE_LABELS.IN_PROGRESS },
  { key: "AWAITING_MENTOR_JOIN", label: STAGE_LABELS.AWAITING_MENTOR_JOIN },
  { key: "MENTOR_ASSIGNED", label: STAGE_LABELS.MENTOR_ASSIGNED },
  { key: "ABANDONED", label: STAGE_LABELS.ABANDONED },
]

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="hidden h-4 w-32 sm:block" />
          <Skeleton className="hidden h-4 w-10 sm:block" />
        </div>
      ))}
    </div>
  )
}

export function GroupsView() {
  const { data, isLoading, mutate } = useCases()
  const [filter, setFilter] = React.useState<Filter>("ALL")
  const [query, setQuery] = React.useState("")
  const [sort, setSort] = React.useState<Sort>("newest")

  const cases = data ?? []

  const rows = React.useMemo(() => {
    let out = cases
    if (filter !== "ALL") out = out.filter((c) => c.stage === filter)
    const q = query.trim().toLowerCase()
    if (q) {
      out = out.filter((c) =>
        [c.student_name, c.project_name, c.mentor_name]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q)),
      )
    }
    const sorted = [...out]
    sorted.sort((a, b) => {
      if (sort === "newest")
        return +new Date(b.created_at) - +new Date(a.created_at)
      if (sort === "oldest")
        return +new Date(a.created_at) - +new Date(b.created_at)
      return daysSince(b.created_at) - daysSince(a.created_at)
    })
    return sorted
  }, [cases, filter, query, sort])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Groups</h1>
        <p className="text-sm text-muted-foreground">
          WhatsApp groups created for students and the follow-up actions your
          team owns.
        </p>
      </div>

      <StatTiles
        cases={cases}
        loading={isLoading}
        active={filter}
        onSelect={setFilter}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <InputGroup className="w-full sm:max-w-xs">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search student, project, or mentor"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Sort
            </span>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="longest">Longest open</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.map((chip) => (
            <Button
              key={chip.key}
              size="sm"
              variant={filter === chip.key ? "secondary" : "ghost"}
              className={cn(
                "rounded-full",
                filter === chip.key && "ring-1 ring-border",
              )}
              onClick={() => setFilter(chip.key)}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>No groups found</EmptyTitle>
            <EmptyDescription>
              {query || filter !== "ALL"
                ? "Try clearing the search or filters to see more groups."
                : "New student groups will appear here once they are created."}
            </EmptyDescription>
          </EmptyHeader>
          {(query || filter !== "ALL") && (
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("")
                  setFilter("ALL")
                }}
              >
                Clear filters
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "group" : "groups"}
          </p>
          <GroupsTable rows={rows} onChanged={() => void mutate()} />
        </div>
      )}
    </div>
  )
}
