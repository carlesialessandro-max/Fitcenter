import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/contexts/AuthContext"
import { chiamateApi } from "@/api/chiamate"
import {
  ESITI_TELEFONATA_CRM,
  ESITO_TELEFONATA_DEFAULT,
  TELEFONATA_ATTIVITA,
  TELEFONATA_AZIONE,
  type EsitoTelefonataCrm,
} from "@/lib/telefonate-crm"

function normalizeTel(tel: string): string {
  const n = tel.replace(/\s/g, "").replace(/^\+?39/, "")
  return n ? `+39${n}` : tel
}

type Props = {
  consulenteNomeOverride?: string
}

export function InserisciTelefonataForm({ consulenteNomeOverride }: Props) {
  const queryClient = useQueryClient()
  const { role, consulenteNome } = useAuth()
  const effectiveConsulente = (consulenteNomeOverride ?? consulenteNome).trim()

  const [nomeContatto, setNomeContatto] = useState("")
  const [telefono, setTelefono] = useState("")
  const [storico, setStorico] = useState("")
  const [esitoCrm, setEsitoCrm] = useState<EsitoTelefonataCrm>(ESITO_TELEFONATA_DEFAULT)
  const [feedback, setFeedback] = useState<string | null>(null)

  const createM = useMutation({
    mutationFn: () =>
      chiamateApi.create({
        consulenteId: effectiveConsulente,
        consulenteNome: effectiveConsulente,
        tipo: "cliente",
        nomeContatto: nomeContatto.trim(),
        telefono: normalizeTel(telefono),
        esitoCrm,
        note: storico.trim() || undefined,
        attivita: TELEFONATA_ATTIVITA,
        azione: TELEFONATA_AZIONE,
        evasoAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chiamate"] })
      queryClient.invalidateQueries({ queryKey: ["chiamate-stats"] })
      queryClient.invalidateQueries({ queryKey: ["data", "crm-telefonate-operatore"] })
      setNomeContatto("")
      setTelefono("")
      setStorico("")
      setFeedback("Telefonata registrata come evasa.")
    },
    onError: (e) => setFeedback((e as Error).message ?? "Errore salvataggio"),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setFeedback(null)
    if (role === "admin" && !effectiveConsulente) {
      setFeedback("Seleziona una consulente nel filtro sopra.")
      return
    }
    if (!nomeContatto.trim() || !telefono.trim()) {
      setFeedback("Nome e telefono sono obbligatori.")
      return
    }
    createM.mutate()
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Inserisci telefonata</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Salva la chiamata come evasa con esito (come «Evaso il» nel gestionale).
          </p>
        </div>
        {role === "admin" && !effectiveConsulente ? (
          <p className="text-xs text-amber-300">Seleziona la consulente nel filtro per registrare a suo nome.</p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-zinc-300">
          Attività: <strong className="font-medium text-zinc-100">{TELEFONATA_ATTIVITA}</strong>
        </span>
        <span className="rounded border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-zinc-300">
          Azione: <strong className="font-medium text-zinc-100">{TELEFONATA_AZIONE}</strong>
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-zinc-400">
          Nome contatto
          <input
            value={nomeContatto}
            onChange={(e) => setNomeContatto(e.target.value)}
            placeholder="es. Mario Rossi"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Telefono
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="es. 333 1234567"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Esito
          <select
            value={esitoCrm}
            onChange={(e) => setEsitoCrm(e.target.value as EsitoTelefonataCrm)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
          >
            {ESITI_TELEFONATA_CRM.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-zinc-400 sm:col-span-2 lg:col-span-4">
          Storico
          <textarea
            value={storico}
            onChange={(e) => setStorico(e.target.value)}
            rows={3}
            placeholder="Note della telefonata (come nel CRM gestionale)"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={createM.isPending}
          className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {createM.isPending ? "Salvataggio…" : "Salva telefonata evasa"}
        </button>
        {feedback ? (
          <span className={`text-sm ${feedback.includes("registrata") ? "text-emerald-400" : "text-red-300"}`}>
            {feedback}
          </span>
        ) : null}
      </div>
    </form>
  )
}
