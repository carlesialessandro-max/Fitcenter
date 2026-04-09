import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { prenotazioniApi, type PrenotazioneCorsoRow } from "@/api/prenotazioni"
import { useAuth } from "@/contexts/AuthContext"

function isoToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function pickColumns(rows: PrenotazioneCorsoRow[]): string[] {
  if (rows.length === 0) return []
  const first = rows[0]?.raw ?? {}
  const keys = Object.keys(first)
  const preferred = [
    "Corso",
    "NomeCorso",
    "CorsoDescrizione",
    "Attivita",
    "DescrizioneCorso",
    "Ora",
    "OraInizio",
    "OraFine",
    "Sala",
    "Istruttore",
    "NomeIstruttore",
  ]
  const picked = preferred.filter((k) => keys.includes(k))
  const rest = keys.filter((k) => !picked.includes(k)).slice(0, 6)
  return [...picked, ...rest]
}

function cellValue(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  // Date da mssql spesso arriva come string o Date serializzabile
  if (v instanceof Date) return v.toISOString()
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function Corsi() {
  const { role } = useAuth()
  const [giorno, setGiorno] = useState(() => isoToday())

  const enabled = role === "admin" || role === "corsi"

  const { data, isLoading, error } = useQuery({
    queryKey: ["prenotazioni-corsi", giorno],
    queryFn: () => prenotazioniApi.listPrenotazioni(giorno),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const rows = data?.rows ?? []
  const cols = useMemo(() => pickColumns(rows), [rows])

  if (!enabled) {
    return (
      <div className="p-6 text-red-400">
        Permessi insufficienti.
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Corsi</h1>
          <p className="mt-1 text-sm text-zinc-400">Prenotazioni corsi con numero partecipanti.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Giorno
          <input
            type="date"
            value={giorno}
            onChange={(e) => setGiorno(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
          />
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        {isLoading ? (
          <p className="text-sm text-zinc-500">Caricamento...</p>
        ) : error ? (
          <p className="text-sm text-red-400">Errore: {(error as Error).message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500">Nessuna prenotazione per il giorno selezionato.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-zinc-800">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60">
                  <th className="px-3 py-2 font-medium text-zinc-400">Giorno</th>
                  <th className="px-3 py-2 font-medium text-zinc-400">Partecipanti</th>
                  {cols.map((c) => (
                    <th key={c} className="px-3 py-2 font-medium text-zinc-400">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-900 last:border-0 hover:bg-zinc-800/30">
                    <td className="px-3 py-2 text-zinc-200">{r.giorno ?? ""}</td>
                    <td className="px-3 py-2 font-medium text-amber-400">{r.partecipanti ?? ""}</td>
                    {cols.map((c) => (
                      <td key={c} className="px-3 py-2 text-zinc-300">{cellValue(r.raw?.[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

