import { useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { leadsApi } from "@/api/leads"
import { useAuth } from "@/contexts/AuthContext"
import type { LeadStatus, LeadUpdate } from "@/types/lead"
import { LEAD_STATUS_LABELS, INTERESSE_LABELS } from "@/types/lead"
import { crmConsulentiLeadOptionsForAssign, CRM_CONSULENTI_LEAD } from "./crmConsulenti"
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

  const lead = useMemo(() => (id ? leads.find((l) => l.id === id) : undefined), [id, leads])

  const consulenteSelectValue = useMemo(() => {
    if (!lead) return ""
    const byId = lead.consulenteId ? CRM_CONSULENTI_LEAD.find((x) => x.id === lead.consulenteId) : undefined
    if (byId) return byId.id
    const byNome = lead.consulenteNome ? CRM_CONSULENTI_LEAD.find((x) => x.nome === lead.consulenteNome) : undefined
    if (byNome) return byNome.id
    if (lead.consulenteNome || lead.consulenteId) return "__unknown__"
    return ""
  }, [lead])

  const today = new Date()
  const fromIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`
  const toIso = `${today.getFullYear()}-${String(today.getMonth() + 2).padStart(2, "0")}-01`
  const cognomeCrm = String(lead?.cognome ?? "").trim()
  const nomeCrm = String(lead?.nome ?? "").trim()
  const canQueryCrm = !!id && !!lead && !!cognomeCrm && !!nomeCrm && cognomeCrm !== "—" && nomeCrm !== "—"
  const crmClienteQ = useQuery({
    queryKey: ["data", "crm-appuntamenti-cliente", cognomeCrm, nomeCrm, fromIso, toIso],
    queryFn: () => dataApi.getCrmAppuntamentiCliente({ cognome: cognomeCrm, nome: nomeCrm, from: fromIso, to: toIso }),
    enabled: canQueryCrm,
    retry: false,
  })
  const crmAppuntamenti = useMemo(() => crmClienteQ.data?.rows ?? [], [crmClienteQ.data])
  const loadingCrm = crmClienteQ.isLoading

  const updateMutation = useMutation({
    mutationFn: (updates: LeadUpdate) => leadsApi.update(id!, updates),
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
              <dd className="text-zinc-100">
                {role === "admin" ? (
                  <select
                    className="mt-1 w-full max-w-xs rounded-md border border-zinc-700 bg-zinc-950/50 px-2 py-1.5 text-sm text-zinc-100"
                    value={consulenteSelectValue}
                    disabled={updateMutation.isPending}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === "__unknown__") return
                      const opt = crmConsulentiLeadOptionsForAssign().find((o) => o.id === v)
                      if (!opt?.id) {
                        updateMutation.mutate({ consulenteId: "", consulenteNome: "" })
                      } else {
                        updateMutation.mutate({ consulenteId: opt.id, consulenteNome: opt.nome })
                      }
                    }}
                  >
                    {consulenteSelectValue === "__unknown__" ? (
                      <option value="__unknown__" disabled>
                        {lead.consulenteNome ?? lead.consulenteId ?? "Assegnato"} (scegli dall&apos;elenco)
                      </option>
                    ) : null}
                    {crmConsulentiLeadOptionsForAssign().map((o) => (
                      <option key={o.id || "__none__"} value={o.id}>
                        {o.nome}
                      </option>
                    ))}
                  </select>
                ) : (
                  lead.consulenteNome ?? "Non assegnato"
                )}
              </dd>
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
            {updateMutation.isError ? (
              <div className="mt-2 text-xs text-red-300">
                Errore salvataggio note: {String((updateMutation.error as any)?.message ?? "—")}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {canQueryCrm ? (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Appuntamenti CRM (mese in corso)</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Cliente: <span className="text-zinc-300">{cognomeCrm} {nomeCrm}</span>
          </p>
          {loadingCrm ? (
            <div className="mt-3 text-sm text-zinc-500">Caricamento…</div>
          ) : crmAppuntamenti.length === 0 ? (
            <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/20 px-3 py-3 text-sm text-zinc-500">
              Nessun appuntamento CRM trovato per questo lead nel mese corrente.
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-zinc-700">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-700 bg-zinc-800/50">
                    <th className="px-3 py-2 font-medium text-zinc-400">Data</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Tipo</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Esito</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">CRM</th>
                  </tr>
                </thead>
                <tbody>
                  {crmAppuntamenti.map((row, i) => (
                    <tr key={i} className="border-b border-zinc-800 last:border-0">
                      <td className="px-3 py-2 text-zinc-300">
                        {row.dataAppuntamento
                          ? new Date(row.dataAppuntamento).toLocaleDateString("it-IT", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-300">{row.tipoDescrizione || "—"}</td>
                      <td className="px-3 py-2 text-zinc-300">{row.esitoDescrizione || "—"}</td>
                      <td className="px-3 py-2 text-zinc-300">{row.crmDescrizione || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-4 text-xs text-zinc-500">
        Creato il {new Date(lead.createdAt).toLocaleString("it-IT")} · Aggiornato il{" "}
        {new Date(lead.updatedAt).toLocaleString("it-IT")}
      </div>
    </div>
  )
}
