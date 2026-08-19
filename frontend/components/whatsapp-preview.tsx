import { CheckCheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * An exact preview of the WhatsApp message that will be sent to the group.
 * Rendered as an outgoing chat bubble so the team sees precisely what families
 * will receive before confirming.
 */
export function WhatsappPreview({
  message,
  groupName,
  className,
}: {
  message: string
  groupName?: string
  className?: string
}) {
  const time = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-[#e6ddd4] p-3 dark:bg-[#0b141a]",
        className,
      )}
    >
      {groupName ? (
        <p className="mb-2 truncate text-center text-[11px] font-medium text-black/50 dark:text-white/50">
          {groupName}
        </p>
      ) : null}
      <div className="flex justify-end">
        <div className="relative max-w-[85%] rounded-lg rounded-tr-sm bg-[#d9fdd3] px-2.5 py-1.5 text-sm text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {message}
          </p>
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-black/45 dark:text-white/60">
            {time}
            <CheckCheckIcon className="size-3.5 text-[#53bdeb]" />
          </span>
        </div>
      </div>
    </div>
  )
}
