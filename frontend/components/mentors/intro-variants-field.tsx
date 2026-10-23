"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"

/**
 * The editor for a mentor's extra introductions.
 *
 * A mentor has one default introduction (the `intro` field, edited next to
 * this) plus any number of named ones. The name is not decoration: it is the
 * key stored in `variants` and the label the team picks from when they queue
 * an introduction, so it is kept short and is lowercased on save to match how
 * the backend resolves it.
 *
 * State is a list rather than an object so a half-typed row with no name yet
 * is representable — an object would collapse every unnamed row into one key.
 */

export interface VariantRow {
  /** Stable across re-renders so React doesn't remount a row being typed in. */
  id: string
  label: string
  text: string
}

export const newVariantRow = (): VariantRow => ({
  id: Math.random().toString(36).slice(2, 10),
  label: "",
  text: "",
})

/** `variants` from the API into editable rows. */
export function rowsFromVariants(
  variants: Record<string, string> | null | undefined,
): VariantRow[] {
  return Object.entries(variants ?? {}).map(([label, text]) => ({
    id: `${label}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    text,
  }))
}

/** The dashboard's name for the default introduction. Not usable as a label. */
const RESERVED = ["general", "default"]

export interface VariantsState {
  /** null when there is nothing to send (no rows), else the map to save. */
  variants: Record<string, string> | null
  /** User-facing reason the rows aren't savable yet, or null when they are. */
  error: string | null
  /** True when at least one row has been started. */
  touched: boolean
}

/**
 * Validate the rows and build what goes on the wire. Mirrors the backend's
 * `variantsSchema`, so a save is refused here with a readable message rather
 * than coming back as a 400.
 */
export function variantsFromRows(rows: VariantRow[]): VariantsState {
  const started = rows.filter((r) => r.label.trim() || r.text.trim())
  if (started.length === 0) {
    return { variants: null, error: null, touched: false }
  }

  const out: Record<string, string> = {}
  for (const row of started) {
    const label = row.label.trim().toLowerCase()
    const text = row.text.trim()

    if (!label) return { variants: null, error: "Give every introduction a name.", touched: true }
    if (!text) {
      return {
        variants: null,
        error: `"${label}" has no message — write it or remove the row.`,
        touched: true,
      }
    }
    if (RESERVED.includes(label)) {
      return {
        variants: null,
        error: `"${label}" is reserved — it is what the default introduction is called.`,
        touched: true,
      }
    }
    if (out[label] !== undefined) {
      return {
        variants: null,
        error: `Two introductions are both named "${label}".`,
        touched: true,
      }
    }
    out[label] = text
  }

  if (Object.keys(out).length > 12) {
    return { variants: null, error: "At most 12 named introductions.", touched: true }
  }
  return { variants: out, error: null, touched: true }
}

export function IntroVariantsField({
  rows,
  onChange,
  idPrefix,
}: {
  rows: VariantRow[]
  onChange: (rows: VariantRow[]) => void
  /** Keeps input ids unique when two dialogs exist in one tree. */
  idPrefix: string
}) {
  const { error } = variantsFromRows(rows)

  const update = (id: string, patch: Partial<VariantRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  return (
    <Field>
      <FieldLabel>Additional introductions</FieldLabel>
      <FieldDescription>
        Optional. Alternative wordings for this mentor — one per subject or
        project type. When a mentor has more than one, whoever sends or queues
        the introduction has to choose which goes out.
      </FieldDescription>

      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={row.id} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Input
                id={`${idPrefix}-variant-label-${i}`}
                value={row.label}
                placeholder="Name, e.g. chemistry"
                aria-label={`Introduction ${i + 1} name`}
                onChange={(e) => update(row.id, { label: e.target.value })}
                className="h-8"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove introduction ${row.label.trim() || i + 1}`}
                onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
              >
                <Trash2 />
              </Button>
            </div>
            <Textarea
              id={`${idPrefix}-variant-text-${i}`}
              value={row.text}
              placeholder="The wording that goes out for this one…"
              aria-label={`Introduction ${i + 1} message`}
              onChange={(e) => update(row.id, { text: e.target.value })}
              rows={4}
            />
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => onChange([...rows, newVariantRow()])}
        >
          <Plus data-icon="inline-start" />
          {rows.length === 0 ? "Add another introduction" : "Add one more"}
        </Button>
      </div>

      {error ? <FieldDescription className="text-destructive">{error}</FieldDescription> : null}
    </Field>
  )
}
