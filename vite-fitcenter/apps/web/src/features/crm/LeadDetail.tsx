import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { leadsApi } from "@/api/leads"
import { useAuth } from "@/contexts/AuthContext"
import type { LeadStatus, InteresseLead } from "@/types/lead"
import { LEAD_STATUS_LABELS, INTERESSE_LABELS } from "@/types/lead"
import { LeadSourceBadge } from "./LeadSourceBadge"
import { LeadStatusBadge } from "./LeadStatusBadge"
import { ChiamaButton } from "@/components/ChiamaButton"
import { Button } from "@workspace/ui/components/button"

const STATUSES: LeadStatus[] = ["nuovo", "contattato", "appuntamento", "tour", "proposta", "chiuso_vinto", "chiuso_perso"]

export function LeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { role } = useAuth()

  const { data: leads = [], isLoading, error } = useQuery({
    queryKey: ["data", "leads"],
    queryFn: () => dataApi.getLeads(),
    enabled: !!id,
  })
  const lead = leads.find((l) => l.id === id)

  const updateMutation = useMutation({
    mutationFn: (updates: { stato?: LeadStatus; interesse?: InteresseLead; note?: string }) =>
      leadsApi.update(id!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data", "leads"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => leadsApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data", "leads"] })
      navigate("/crm")
    },
  })

  if (!id) {
    return (
      <div className="p-6">
        <p className="text-zinc-400">ID lead mancante.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-zinc-400">Caricamento...</div>
      </div>
    )
  }
  if (error || !lead) {
    return (
      <div className="p-6">
        <div className="text-zinc-400">
          {error ? (error as Error).message : "Lead non trovato."}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/crm")}>
            ← Indietro
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">
              {lead.nome} {lead.cognome}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <LeadSourceBadge source={lead.fonte} />
              <LeadStatusBadge status={lead.stato} />
            </div>
          </div>
        </div>
        {role === "admin" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!confirm("Eliminare definitivamente questo lead?")) return
              deleteMutation.mutate()
            }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Contatti</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-zinc-500">Email</dt>
              <dd className="text-zinc-100">{lead.email}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Telefono</dt>
              <dd className="flex items-center gap-2 text-zinc-100">
                {lead.telefono}
                {lead.telefono && (
                  <ChiamaButton
                    telefono={lead.telefono}
                    nomeContatto={`${lead.nome} ${lead.cognome}`}
                    tipo="lead"
                    leadId={lead.id}
                  />
                )}
              </dd>
            </div>
            {lead.fonteDettaglio && (
              <div>
                <dt className="text-zinc-500">Dettaglio fonte</dt>
                <dd className="text-zinc-100">{lead.fonteDettaglio}</dd>
              </div>
            )}
            <div>
              <dt className="text-zinc-500">Interesse</dt>
              <dd className="text-zinc-100">
                {lead.interesse ? INTERESSE_LABELS[lead.interesse] : lead.interesseDettaglio ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Consulente</dt>
              <dd className="text-zinc-100">{lead.consulenteNome ?? "Non assegnato"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Stato e azioni</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={lead.stato === s ? "default" : "outline"}
                onClick={() => updateMutation.mutate({ stato: s })}
                disabled={updateMutation.isPending}
              >
                {LEAD_STATUS_LABELS[s]}
              </Button>
            ))}
          </div>
          <div className="mt-4">
            <label className="block text-sm text-zinc-500">Note</label>
            <textarea
              defaultValue={lead.note ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== (lead.note ?? "")) updateMutation.mutate({ note: v })
              }}
              rows={3}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/50 focus:outline-none"
              placeholder="Note del consulente..."
            />
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs text-zinc-500">
        Creato il {new Date(lead.createdAt).toLocaleString("it-IT")} · Aggiornato il{" "}
        {new Date(lead.updatedAt).toLocaleString("it-IT")}
      </div>
    </div>
  )
}
