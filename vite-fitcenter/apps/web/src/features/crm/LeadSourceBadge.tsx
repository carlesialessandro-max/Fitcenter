import { cn } from "@workspace/ui/lib/utils"
import type { LeadSource } from "@/types/lead"
import { LEAD_SOURCE_LABELS } from "@/types/lead"

const sourceColors: Record<LeadSource, string> = {
  website: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  facebook: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  google: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  tour_spontaneo: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  sql_server: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  zapier: "bg-orange-500/20 text-orange-400 border-orange-500/30",
}

export function LeadSourceBadge({
  source,
  className,
}: {
  source: LeadSource
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        sourceColors[source],
        className
      )}
    >
      {LEAD_SOURCE_LABELS[source]}
    </span>
  )
}
