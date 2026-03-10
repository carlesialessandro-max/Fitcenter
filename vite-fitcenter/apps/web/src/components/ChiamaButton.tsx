import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useConsulente } from "@/contexts/ConsulenteContext"
import { chiamateApi, type TipoContatto } from "@/api/chiamate"

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

  const href = telefono ? `tel:${normalizeTel(telefono)}` : "#"

  const handleClick = (e: React.MouseEvent) => {
    if (!telefono.trim()) {
      e.preventDefault()
      return
    }
    if (registraAlClick) {
      e.preventDefault()
      logChiamata.mutate(undefined, {
        onSettled: () => {
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
      Chiama
    </a>
  )
}
