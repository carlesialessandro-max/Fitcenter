import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { dataApi } from "@/api/data"
import type { Lead, LeadSource, LeadStatus } from "@/types/lead"
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, INTERESSE_LABELS } from "@/types/lead"
import { LeadSourceBadge } from "./LeadSourceBadge"
import { LeadStatusBadge } from "./LeadStatusBadge"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChiamaButton } from "@/components/ChiamaButton"
import { Button } from "@workspace/ui/components/button"
import { useAuth } from "@/contexts/AuthContext"
import { leadsApi } from "@/api/leads"

const PIPELINE_STATUSES: LeadStatus[] = [
  "nuovo",
  "contattato",
  "appuntamento",
  "tour",
  "proposta",
  "chiuso_vinto",
  "chiuso_perso",
]
const CARD_COLORS: Record<LeadStatus, string> = {
  nuovo: "bg-sky-500/20 border-sky-500/40 text-sky-300",
  contattato: "bg-amber-500/20 border-amber-500/40 text-amber-300",
  appuntamento: "bg-violet-500/20 border-violet-500/40 text-violet-300",
  tour: "bg-cyan-500/20 border-cyan-500/40 text-cyan-300",
  proposta: "bg-orange-500/20 border-orange-500/40 text-orange-300",
  chiuso_vinto: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
  chiuso_perso: "bg-red-500/20 border-red-500/40 text-red-300",
}
/** Fonti per filtro: solo quelle attive (no sql_server). Lead da Zapier/sito/FB/Google + tour spontanei manuali. */
const SOURCES: LeadSource[] = ["website", "facebook", "google", "tour_spontaneo"]

export function LeadList() {
  const queryClient = useQueryClient()
  const { consulenteNome } = useAuth()
  const [search, setSearch] = useState("")
  const [fonte, setFonte] = useState<LeadSource | "">("")
  const [consulente, setConsulente] = useState("")

  const assignToMe = useMutation({
    mutationFn: (leadId: string) => leadsApi.update(leadId, { consulenteNome }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data", "leads"] })
    },
  })

  const { data: allLeads = [], isLoading, error } = useQuery({
    queryKey: ["data", "leads"],
    queryFn: () => dataApi.getLeads(),
  })

  const filtered = useMemo(() => {
    let list: Lead[] = [...allLeads]
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(
        (l) =>
          `${l.nome} ${l.cognome}`.toLowerCase().includes(s) ||
          l.email.toLowerCase().includes(s) ||
          (l.telefono && l.telefono.includes(s))
      )
    }
    if (fonte) list = list.filter((l) => l.fonte === fonte)
    if (consulente) list = list.filter((l) => l.consulenteNome === consulente)
    return list
  }, [allLeads, search, fonte, consulente])

  const countsByStatus = useMemo(() => {
    const m: Record<LeadStatus, number> = {
      nuovo: 0,
      contattato: 0,
      appuntamento: 0,
      tour: 0,
      proposta: 0,
      chiuso_vinto: 0,
      chiuso_perso: 0,
    }
    filtered.forEach((l) => {
      m[l.stato] = (m[l.stato] ?? 0) + 1
    })
    return m
  }, [filtered])

  const consulenti = useMemo(() => {
    const set = new Set<string>()
    allLeads.forEach((l) => l.consulenteNome && set.add(l.consulenteNome))
    return Array.from(set).filter((c) => c !== "Amministratore").sort()
  }, [allLeads])

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">CRM Vendita</h1>
          <p className="text-sm text-zinc-400">Gestione lead e pipeline di vendita</p>
        </div>
        <Link to="/crm/nuovo">
          <Button>+ Aggiungi lead (tour spontanei)</Button>
        </Link>
      </div>

      {/* Pipeline cards */}
      <div className="mt-6 flex flex-wrap gap-2">
        {PIPELINE_STATUSES.map((stato) => (
          <div
            key={stato}
            className={`rounded-lg border px-3 py-2 text-center ${CARD_COLORS[stato]}`}
          >
            <p className="text-xs font-medium opacity-90">{LEAD_STATUS_LABELS[stato]}</p>
            <p className="text-lg font-bold">{countsByStatus[stato]}</p>
          </div>
        ))}
      </div>

      {/* Filtri */}
      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex flex-1 min-w-[200px] items-center gap-2">
          <input
            type="search"
            placeholder="Cerca per nome, email, telefono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
          />
        </div>
        <select
          value={fonte}
          onChange={(e) => setFonte((e.target.value || "") as LeadSource | "")}
          className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100"
        >
          <option value="">Tutte le fonti</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
          ))}
        </select>
        <select
          value={consulente}
          onChange={(e) => setConsulente(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100"
        >
          <option value="">Tutti i consulenti</option>
          {consulenti.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
        <p className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm text-zinc-400">
          Lead ({filtered.length})
        </p>
        {isLoading && (
          <div className="flex justify-center py-12 text-zinc-400">Caricamento...</div>
        )}
        {error && (
          <div className="py-8 text-center text-red-400">
            Errore: {(error as Error).message}. Avvia l’API backend.
          </div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="py-12 text-center text-zinc-400">Nessun lead trovato.</div>
        )}
        {!isLoading && !error && filtered.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/50">
              <tr>
                <th className="px-4 py-3 font-medium text-zinc-400">Nome</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Contatto</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Fonte</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Interesse</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Stato</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Consulente</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Data</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((lead) => (
                <tr key={lead.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/crm/lead/${lead.id}`}
                      className="font-medium text-amber-400 hover:underline"
                    >
                      {lead.nome} {lead.cognome}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    <div>{lead.email}</div>
                    <div className="text-xs text-zinc-500">{lead.telefono}</div>
                  </td>
                  <td className="px-4 py-3">
                    <LeadSourceBadge source={lead.fonte} />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {lead.interesse ? INTERESSE_LABELS[lead.interesse] : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <LeadStatusBadge status={lead.stato} />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{lead.consulenteNome ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {new Date(lead.createdAt).toLocaleDateString("it-IT")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {lead.consulenteNome !== consulenteNome && (
                        <button
                          type="button"
                          onClick={() => assignToMe.mutate(lead.id)}
                          disabled={assignToMe.isPending}
                          className="rounded px-2 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20"
                        >
                          Assegna a me
                        </button>
                      )}
                      {lead.telefono && (
                        <ChiamaButton
                          telefono={lead.telefono}
                          nomeContatto={`${lead.nome} ${lead.cognome}`}
                          tipo="lead"
                          leadId={lead.id}
                        />
                      )}
                      <Link to={`/crm/lead/${lead.id}`} className="text-zinc-400 hover:text-zinc-200" title="Dettaglio">
                        👁
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
