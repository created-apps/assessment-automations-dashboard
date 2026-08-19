"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn("text-muted-foreground", className)}
      onClick={copy}
      aria-label={label ? `Copy ${label}` : "Copy"}
    >
      {copied ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
    </Button>
  )
}

/** A copyable field: label + monospace value + copy button. */
export function CopyField({
  mono = false,
  value,
  label,
  className,
}: {
  mono?: boolean
  value: string
  label?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md",
        className,
      )}
    >
      <span
        className={cn(
          "truncate",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
      <CopyButton
        value={value}
        label={label}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  )
}
