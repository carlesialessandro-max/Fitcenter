import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/contexts/AuthContext"
import { chiamateApi, type EsitoChiamata, type TipoContatto } from "@/api/chiamate"

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
  const [tipo, setTipo] = useState<TipoContatto>("cliente")
  const [esito, setEsito] = useState<EsitoChiamata>("altro")
  const [note, setNote] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)

  const createM = useMutation({
    mutationFn: () =>
      chiamateApi.create({
        consulenteId: effectiveConsulente,
        consulenteNome: effectiveConsulente,
        tipo,
        nomeContatto: nomeContatto.trim(),
        telefono: normalizeTel(telefono),
        esito,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chiamate"] })
      queryClient.invalidateQueries({ queryKey: ["chiamate-stats"] })
      setNomeContatto("")
      setTelefono("")
      setNote("")
      setFeedback("Telefonata registrata.")
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
            Registra una chiamata effettuata (anche senza WhatsApp). Compare nello storico e nel report.
          </p>
        </div>
        {role === "admin" && !effectiveConsulente ? (
          <p className="text-xs text-amber-300">Seleziona la consulente nel filtro per registrare a suo nome.</p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
          Tipo
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoContatto)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
          >
            <option value="cliente">Cliente</option>
            <option value="lead">Lead</option>
          </select>
        </label>
        <label className="block text-xs text-zinc-400">
          Esito
          <select
            value={esito}
            onChange={(e) => setEsito(e.target.value as EsitoChiamata)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
          >
            <option value="risposto">Risposto</option>
            <option value="non_risposto">Non risposto</option>
            <option value="occupato">Occupato</option>
            <option value="altro">Altro</option>
          </select>
        </label>
        <label className="block text-xs text-zinc-400 sm:col-span-2 lg:col-span-1">
          Note (opz.)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
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
          {createM.isPending ? "Salvataggio…" : "Salva telefonata"}
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
