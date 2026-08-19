"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import type { CaseSummary, Stage } from "@/lib/types"

type Filter = Stage | "ALL"

interface Tile {
  key: Filter
  label: string
  count: (cases: CaseSummary[]) => number
  dot: string
}

const TILES: Tile[] = [
  {
    key: "NEW",
    label: "Awaiting first action",
    count: (c) => c.filter((x) => x.stage === "NEW").length,
    dot: "bg-amber-500",
  },
  {
    key: "IN_PROGRESS",
    label: "In progress",
    count: (c) => c.filter((x) => x.stage === "IN_PROGRESS").length,
    dot: "bg-blue-500",
  },
  {
    key: "MENTOR_ASSIGNED",
    label: "Mentor assigned",
    count: (c) => c.filter((x) => x.stage === "MENTOR_ASSIGNED").length,
    dot: "bg-emerald-500",
  },
  {
    key: "ALL",
    label: "Total active",
    count: (c) => c.filter((x) => x.stage !== "ABANDONED").length,
    dot: "bg-brand",
  },
]

export function StatTiles({
  cases,
  loading,
  active,
  onSelect,
}: {
  cases: CaseSummary[]
  loading: boolean
  active: Filter
  onSelect: (f: Filter) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {TILES.map((tile) => {
        const isActive = active === tile.key
        return (
          <button
            key={tile.key}
            type="button"
            onClick={() => onSelect(tile.key)}
            aria-pressed={isActive}
            className={cn(
              "group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              isActive && "border-foreground/30 bg-muted/60 ring-1 ring-foreground/10",
            )}
          >
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", tile.dot)} />
              {tile.label}
            </span>
            {loading ? (
              <Skeleton className="h-8 w-10" />
            ) : (
              <span className="text-3xl font-semibold tabular-nums tracking-tight">
                {tile.count(cases)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
