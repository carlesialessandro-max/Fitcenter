import { useNavigate } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { leadsApi } from "@/api/leads"
import type { LeadSource, InteresseLead } from "@/types/lead"
import { LEAD_SOURCE_LABELS, INTERESSE_LABELS } from "@/types/lead"
import { Button } from "@workspace/ui/components/button"
import { useState } from "react"

const FONTI: LeadSource[] = ["website", "facebook", "google", "sql_server"]
const INTERESSI: InteresseLead[] = ["palestra", "piscina", "spa", "corsi", "full_premium"]

export function NewLead() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [nome, setNome] = useState("")
  const [cognome, setCognome] = useState("")
  const [email, setEmail] = useState("")
  const [telefono, setTelefono] = useState("")
  const [fonte, setFonte] = useState<LeadSource>("website")
  const [interesse, setInteresse] = useState<InteresseLead | "">("")

  const create = useMutation({
    mutationFn: () =>
      leadsApi.create({
        nome,
        cognome,
        email,
        telefono,
        fonte,
        interesse: interesse || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data", "leads"] })
      navigate("/crm")
    },
  })

  return (
    <div className="p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/crm")} className="mb-4">
        ← Indietro
      </Button>
      <h1 className="text-2xl font-semibold text-zinc-100">Nuovo Lead</h1>
      <p className="mt-1 text-sm text-zinc-400">Inserisci i dati del lead</p>

      <form
        className="mt-6 max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <div>
          <label className="block text-sm text-zinc-400">Nome *</label>
          <input
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100 focus:border-amber-500/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400">Cognome *</label>
          <input
            required
            value={cognome}
            onChange={(e) => setCognome(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100 focus:border-amber-500/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400">Email *</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100 focus:border-amber-500/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400">Telefono</label>
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100 focus:border-amber-500/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400">Fonte</label>
          <select
            value={fonte}
            onChange={(e) => setFonte(e.target.value as LeadSource)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100"
          >
            {FONTI.map((f) => (
              <option key={f} value={f}>{LEAD_SOURCE_LABELS[f]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-zinc-400">Interesse</label>
          <select
            value={interesse}
            onChange={(e) => setInteresse((e.target.value || "") as InteresseLead | "")}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-zinc-100"
          >
            <option value="">—</option>
            {INTERESSI.map((i) => (
              <option key={i} value={i}>{INTERESSE_LABELS[i]}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Salvataggio..." : "Salva Lead"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/crm")}>
            Annulla
          </Button>
        </div>
      </form>
    </div>
  )
}
