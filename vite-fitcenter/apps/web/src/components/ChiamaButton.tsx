import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useConsulente } from "@/contexts/AuthContext"
import { chiamateApi, type TipoContatto } from "@/api/chiamate"
import { useAuth } from "@/contexts/AuthContext"

function normalizeTel(tel: string): string {
  const n = tel.replace(/\s/g, "").replace(/^\+?39/, "")
  return n ? `+39${n}` : tel
}

function toWaMeNumber(tel: string): string {
  // wa.me richiede solo cifre in formato internazionale, senza +
  const normalized = normalizeTel(tel)
  const digits = normalized.replace(/[^\d]/g, "")
  return digits
}

type Props = {
  telefono: string
  nomeContatto: string
  tipo: TipoContatto
  leadId?: string
  clienteId?: string
  className?: string
  /** Se true, registra la chiamata al click (prima di aprire tel:) */
  registraAlClick?: boolean
}

export function ChiamaButton({
  telefono,
  nomeContatto,
  tipo,
  leadId,
  clienteId,
  className = "",
  registraAlClick = true,
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
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chiamate"] })
      queryClient.invalidateQueries({ queryKey: ["chiamate-stats"] })
    },
  })

  const telHref = telefono ? `tel:${normalizeTel(telefono)}` : "#"
  const waHref = telefono ? `https://wa.me/${toWaMeNumber(telefono)}` : "#"
  const waAppHref = telefono ? `whatsapp://send?phone=${toWaMeNumber(telefono)}` : "#"
  const href = role === "operatore" ? waHref : telHref

  const handleClick = (e: React.MouseEvent) => {
    if (!telefono.trim()) {
      e.preventDefault()
      return
    }
    if (registraAlClick) {
      e.preventDefault()
      logChiamata.mutate(undefined, {
        onSettled: () => {
          // Nota: WhatsApp Web non avvia chiamate; per chiamare serve WhatsApp Desktop/mobile.
          // Qui proviamo ad aprire l'app desktop (protocollo whatsapp://). Se non disponibile, fallback a wa.me (chat web).
          if (role === "operatore") {
            try {
              window.location.href = waAppHref
              setTimeout(() => window.open(waHref, "_blank", "noopener,noreferrer"), 800)
            } catch {
              window.open(waHref, "_blank", "noopener,noreferrer")
            }
            return
          }
          window.location.href = href
        },
      })
    }
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 ${className}`}
      title={`Chiama ${nomeContatto}`}
    >
      <span aria-hidden>📞</span>
      {role === "operatore" ? "WhatsApp" : "Chiama"}
    </a>
  )
}
