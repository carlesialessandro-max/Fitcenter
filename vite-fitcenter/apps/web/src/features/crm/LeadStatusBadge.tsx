import { cn } from "@workspace/ui/lib/utils"
import type { LeadStatus } from "@/types/lead"
import { LEAD_STATUS_LABELS } from "@/types/lead"

const statusColors: Record<LeadStatus, string> = {
  nuovo: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  contattato: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  appuntamento: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  tour: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  proposta: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  chiuso_vinto: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  chiuso_perso: "bg-red-500/20 text-red-400 border-red-500/30",
}

export function LeadStatusBadge({
  status,
  className,
}: {
  status: LeadStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        statusColors[status],
        className
      )}
    >
      {LEAD_STATUS_LABELS[status]}
    </span>
  )
}
