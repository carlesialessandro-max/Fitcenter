import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import { ChiamaButton } from "@/components/ChiamaButton"
import { Button } from "@workspace/ui/components/button"

export type RinnovoStato =
  | "da_contattare"
  | "contattato"
  | "appuntamento"
  | "rinnovo_confermato"
  | "non_rinnova"
  | "chiuso"

const RINNOVO_STATUSES: RinnovoStato[] = [
  "da_contattare",
  "contattato",
  "appuntamento",
  "rinnovo_confermato",
  "non_rinnova",
  "chiuso",
]

const RINNOVO_LABELS: Record<RinnovoStato, string> = {
  da_contattare: "Da contattare",
  contattato: "Contattato",
  appuntamento: "Appuntamento",
  rinnovo_confermato: "Rinnovo confermato",
  non_rinnova: "Non rinnova",
  chiuso: "Chiuso",
}

export function AbbonamentoDettaglio() {
  const { id: abbonamentoId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { consulenteFilter } = useAuth()

  const { data: abbonamenti = [], isLoading: loadingAbb, error: errAbb } = useQuery({
    queryKey: ["data", "abbonamenti", consulenteFilter ?? ""],
    queryFn: () => dataApi.getAbbonamenti(consulenteFilter ?? undefined),
    enabled: !!abbonamentoId,
  })
  const { data: clienti = [] } = useQuery({
    queryKey: ["data", "clienti"],
    queryFn: () => dataApi.getClienti(),
    enabled: !!abbonamentoId,
  })
  const { data: followUpAll = {} } = useQuery({
    queryKey: ["data", "abbonamenti-follow-up"],
    queryFn: () => dataApi.getAbbonamentiFollowUp(),
    enabled: !!abbonamentoId,
  })

  const abbonamento = abbonamenti.find((a) => a.id === abbonamentoId)
  const cliente = abbonamento ? clienti.find((c) => c.id === abbonamento.clienteId) : undefined
  const followUp = abbonamentoId ? followUpAll[abbonamentoId] : undefined
  const stato = (followUp?.stato as RinnovoStato) ?? "da_contattare"
  const note = followUp?.note ?? ""

  const updateMutation = useMutation({
    mutationFn: (updates: { stato?: RinnovoStato; note?: string }) =>
      dataApi.updateAbbonamentiFollowUp(abbonamentoId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data", "abbonamenti-follow-up"] })
    },
  })

  if (!abbonamentoId) {
    return (
      <div className="p-6">
        <p className="text-zinc-400">ID abbonamento mancante.</p>
      </div>
    )
  }

  if (loadingAbb) {
    return (
      <div className="p-6">
        <div className="text-zinc-400">Caricamento...</div>
      </div>
    )
  }
  if (errAbb || !abbonamento) {
    return (
      <div className="p-6">
        <div className="text-zinc-400">
          {errAbb ? (errAbb as Error).message : "Abbonamento non trovato."}
        </div>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate("/abbonamenti")}>
          ← Torna ad Abbonamenti
        </Button>
      </div>
    )
  }

  const telefono = cliente?.telefono ?? ""

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/abbonamenti")}>
            ← Indietro
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">{abbonamento.clienteNome}</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {abbonamento.abbonamentoDescrizione ?? abbonamento.pianoNome} · Scadenza{" "}
              {new Date(abbonamento.dataFine).toLocaleDateString("it-IT")}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Contatti</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-zinc-500">Email</dt>
              <dd className="text-zinc-100">{cliente?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Telefono</dt>
              <dd className="flex items-center gap-2 text-zinc-100">
                {telefono || "—"}
                {telefono && (
                  <ChiamaButton
                    telefono={telefono}
                    nomeContatto={abbonamento.clienteNome}
                    tipo="cliente"
                    clienteId={abbonamento.clienteId}
                  />
                )}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Abbonamento</dt>
              <dd className="text-zinc-100">{abbonamento.abbonamentoDescrizione ?? abbonamento.pianoNome}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Scadenza</dt>
              <dd className="text-amber-400">{new Date(abbonamento.dataFine).toLocaleDateString("it-IT")}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Consulente</dt>
              <dd className="text-zinc-100">{abbonamento.consulenteNome ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Stato e azioni</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {RINNOVO_STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={stato === s ? "default" : "outline"}
                onClick={() => updateMutation.mutate({ stato: s })}
                disabled={updateMutation.isPending}
              >
                {RINNOVO_LABELS[s]}
              </Button>
            ))}
          </div>
          <div className="mt-4">
            <label className="block text-sm text-zinc-500">Note</label>
            <textarea
              defaultValue={note}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== note) updateMutation.mutate({ note: v })
              }}
              rows={3}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/50 focus:outline-none"
              placeholder="Note del consulente..."
            />
          </div>
        </div>
      </div>

      {followUp?.updatedAt && (
        <div className="mt-4 text-xs text-zinc-500">
          Aggiornato il {new Date(followUp.updatedAt).toLocaleString("it-IT")}
        </div>
      )}
    </div>
  )
}
