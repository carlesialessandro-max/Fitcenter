import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/contexts/AuthContext"
import { chiamateApi, type TipoContatto } from "@/api/chiamate"
import { TELEFONATA_ATTIVITA, TELEFONATA_AZIONE, ESITO_TELEFONATA_DEFAULT } from "@/lib/telefonate-crm"

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
  /** Admin: consulente dal filtro pagina. */
  consulenteNomeOverride?: string
  storico?: string
  attivita?: string
  azione?: string
  esitoCrm?: string
  className?: string
}

export function RegistraTelefonataButton({
  telefono,
  nomeContatto,
  tipo,
  leadId,
  clienteId,
  consulenteNomeOverride,
  storico,
  attivita = TELEFONATA_ATTIVITA,
  azione = TELEFONATA_AZIONE,
  esitoCrm = ESITO_TELEFONATA_DEFAULT,
  className = "",
}: Props) {
  const queryClient = useQueryClient()
  const { role, consulenteNome } = useAuth()
  const effectiveConsulente = (consulenteNomeOverride ?? consulenteNome).trim()

  const logChiamata = useMutation({
    mutationFn: () =>
      chiamateApi.create({
        consulenteId: effectiveConsulente,
        consulenteNome: effectiveConsulente,
        tipo,
        leadId,
        clienteId,
        nomeContatto,
        telefono: normalizeTel(telefono),
        esito: "altro",
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

  function handleClick() {
    if (!telefono.trim()) return
    if (role === "admin" && !effectiveConsulente) {
      alert("Seleziona una consulente nel filtro prima di registrare la telefonata.")
      return
    }
    logChiamata.mutate()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={logChiamata.isPending || !telefono.trim()}
      className={`inline-flex items-center gap-1 rounded-md border border-zinc-600 px-2 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 ${className}`}
      title="Registra telefonata effettuata (senza aprire WhatsApp)"
    >
      {logChiamata.isPending ? "Salvo…" : "Inserisci telefonata"}
    </button>
  )
}
