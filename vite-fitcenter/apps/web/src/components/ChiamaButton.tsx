import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useConsulente } from "@/contexts/AuthContext"
import { chiamateApi, type TipoContatto } from "@/api/chiamate"
import { useAuth } from "@/contexts/AuthContext"
import { TELEFONATA_ATTIVITA, TELEFONATA_AZIONE, ESITO_TELEFONATA_DEFAULT } from "@/lib/telefonate-crm"
import { telHrefIt, waHrefIt } from "@/lib/phone"

function normalizeTel(tel: string): string {
  const n = tel.replace(/\s/g, "").replace(/^\+?39/, "")
  return n ? `+39${n}` : tel
}

type Props = {
  telefono: string
  nomeContatto: string
  tipo: TipoContatto
  leadId?: string
  clienteId?: string
  className?: string
  /** Se true, registra la chiamata al click (senza bloccare l’apertura WhatsApp/tel). */
  registraAlClick?: boolean
  /** Solo icona (utile in tabelle strette). */
  compact?: boolean
  storico?: string
  attivita?: string
  azione?: string
  esitoCrm?: string
}

export function ChiamaButton({
  telefono,
  nomeContatto,
  tipo,
  leadId,
  clienteId,
  className = "",
  registraAlClick = true,
  compact = false,
  storico,
  attivita = TELEFONATA_ATTIVITA,
  azione = TELEFONATA_AZIONE,
  esitoCrm = ESITO_TELEFONATA_DEFAULT,
}: Props) {
  const queryClient = useQueryClient()
  const { consulenteNome } = useConsulente()
  const { role } = useAuth()

  const logChiamata = useMutation({
    mutationFn: () =>
      chiamateApi.create({
        consulenteId: consulenteNome,
        consulenteNome,
        tipo,
        leadId,
        clienteId,
        nomeContatto,
        telefono: normalizeTel(telefono),
        note: storico?.trim() || undefined,
        attivita,
        azione,
        esitoCrm,
        evasoAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chiamate"] })
      queryClient.invalidateQueries({ queryKey: ["chiamate-stats"] })
      queryClient.invalidateQueries({ queryKey: ["data", "crm-telefonate-operatore"] })
    },
  })

  const useWhatsApp = role === "operatore" || role === "crm"
  const waHref = waHrefIt(telefono)
  const telHref = telHrefIt(telefono) ?? (telefono.trim() ? `tel:${normalizeTel(telefono)}` : "#")
  const href = useWhatsApp ? waHref ?? "#" : telHref
  const openInNewTab = useWhatsApp && Boolean(waHref)

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!telefono.trim() || href === "#") {
      e.preventDefault()
      return
    }
    if (registraAlClick) logChiamata.mutate()
  }

  const label = useWhatsApp ? "WhatsApp" : "Chiama"
  const title = useWhatsApp ? `WhatsApp ${nomeContatto}` : `Chiama ${nomeContatto}`

  return (
    <a
      href={href}
      onClick={handleClick}
      target={openInNewTab ? "_blank" : undefined}
      rel={openInNewTab ? "noopener noreferrer" : undefined}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 ${compact ? "justify-center" : ""} ${className}`}
      title={title}
      aria-label={title}
    >
      <span aria-hidden>📞</span>
      {!compact && label}
    </a>
  )
}
