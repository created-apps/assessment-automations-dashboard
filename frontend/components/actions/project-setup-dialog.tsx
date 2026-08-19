"use client"

import * as React from "react"
import { toast } from "sonner"
import { ExternalLink, Save } from "lucide-react"

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
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { saveProjectSetup } from "@/lib/api"
import { useCurriculumSubjects, useProjectSetup } from "@/hooks/use-data"
import type { GroupCase, SetupStepStatus } from "@/lib/types"

const NO_CURRICULUM = "NONE"

const STEP_LABELS: Record<string, string> = {
  step_whatsapp: "WhatsApp",
  step_sync: "SYNC",
  step_drive: "Drive",
  step_curriculum: "Curriculum",
  step_cosmic_student: "COSMIC student",
  step_cosmic_project: "COSMIC project",
  step_cosmic_sync_group: "COSMIC ↔ SYNC",
}

function stepVariant(
  status: SetupStepStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "OK") return "default"
  if (status === "FAILED") return "destructive"
  return "secondary"
}

export function ProjectSetupDialog({
  groupCase,
  open,
  onOpenChange,
  onDone,
}: {
  groupCase: GroupCase
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const { data: setup, mutate: mutateSetup } = useProjectSetup(
    open ? groupCase.id : null,
  )
  const { data: subjects } = useCurriculumSubjects()

  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [subject, setSubject] = React.useState<string>(NO_CURRICULUM)
  const [pending, setPending] = React.useState(false)

  // Prefill from what's been entered before (or the group's existing project
  // name) each time the dialog opens or the saved values load.
  React.useEffect(() => {
    if (!open) return
    setTitle(setup?.project_title ?? groupCase.project_name ?? "")
    setDescription(setup?.project_description ?? "")
    setSubject(setup?.curriculum_subject ?? NO_CURRICULUM)
  }, [open, setup, groupCase.project_name])

  const mentorAssigned = groupCase.stage === "MENTOR_ASSIGNED"

  async function handleSave() {
    if (!title.trim()) return
    setPending(true)
    try {
      await saveProjectSetup(groupCase.id, {
        project_title: title.trim(),
        project_description: description.trim() || undefined,
        curriculum_subject: subject,
      })
      toast.success("Project setup saved", {
        description: mentorAssigned
          ? "The setup will run automatically within a few minutes."
          : "It will run automatically once a mentor is assigned.",
      })
      await mutateSetup()
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save. Please try again.",
      )
    } finally {
      setPending(false)
    }
  }

  const alreadySubmitted = Boolean(setup?.submitted_at)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Project setup</DialogTitle>
          <DialogDescription>
            Enter the project details after the brainstorm. Saving queues the
            Stage 5 automation for {groupCase.group_name}: it updates the
            WhatsApp group, links the mentor on SYNC, and creates the student
            Drive with the curriculum. Nothing is sent from this screen.
          </DialogDescription>
        </DialogHeader>

        {!mentorAssigned ? (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            No mentor is assigned yet. You can save the details now — the setup
            runs automatically once a mentor has been introduced.
          </div>
        ) : null}

        <Field>
          <FieldLabel htmlFor="ps-title">Project title</FieldLabel>
          <Input
            id="ps-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Wildfire early-warning model"
          />
          <FieldDescription>
            Becomes the WhatsApp group title (when it&apos;s still the default)
            and the name of the student&apos;s Drive folder.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="ps-description">Project description</FieldLabel>
          <Textarea
            id="ps-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short summary of the project."
            rows={4}
          />
          <FieldDescription>Shown as the WhatsApp group description.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Curriculum</FieldLabel>
          <Select value={subject} onValueChange={(v) => setSubject(v as string)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a curriculum" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={NO_CURRICULUM}>None</SelectItem>
                {(subjects ?? []).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            The matching curriculum templates are copied into the student&apos;s
            Drive folder. Choose None to skip.
          </FieldDescription>
        </Field>

        {alreadySubmitted && setup ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Setup status</span>
              <Badge variant={setup.status === "FAILED" ? "destructive" : "secondary"}>
                {setup.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([
                "step_whatsapp",
                "step_sync",
                "step_drive",
                "step_curriculum",
                "step_cosmic_student",
                "step_cosmic_project",
                "step_cosmic_sync_group",
              ] as const).map(
                (key) => (
                  <Badge key={key} variant={stepVariant(setup[key])} className="font-normal">
                    {STEP_LABELS[key]}: {setup[key]}
                  </Badge>
                ),
              )}
            </div>
            {setup.last_error ? (
              <p className="text-destructive">{setup.last_error}</p>
            ) : null}
            {setup.drive_folder_url ? (
              <a
                href={setup.drive_folder_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                Open student Drive folder
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        ) : null}

        <DialogFooter showCloseButton>
          <Button onClick={handleSave} disabled={pending || !title.trim()}>
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {alreadySubmitted ? "Update project setup" : "Save & queue setup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
