import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { leadsApi } from "@/api/leads"
import { Button } from "@workspace/ui/components/button"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DEFAULT_MAPPING: Record<string, string> = {
  nome: "nome",
  cognome: "cognome",
  email: "email",
  telefono: "telefono",
}

export function ImportFromSqlDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [connectionString, setConnectionString] = useState("")
  const [query, setQuery] = useState(
    "SELECT nome, cognome, email, telefono FROM LeadSource WHERE importato = 0"
  )
  const [mapping, setMapping] = useState(DEFAULT_MAPPING)
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null)

  const importMutation = useMutation({
    mutationFn: () =>
      leadsApi.importFromSql({
        connectionString,
        query,
        mapping,
      }),
    onSuccess: (data) => {
      setResult(data)
      queryClient.invalidateQueries({ queryKey: ["leads"] })
    },
    onError: () => {
      setResult({ imported: 0, errors: ["Errore di connessione o query. Verifica l’API backend."] })
    },
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl">
        <div className="border-b border-zinc-800 p-4">
          <h2 className="text-lg font-semibold text-zinc-100">
            Importa lead da Microsoft SQL Server
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Inserisci la connection string e la query per prelevare i lead dal database.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400">
              Connection string
            </label>
            <input
              type="password"
              placeholder="Server=...;Database=...;User Id=...;Password=..."
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400">
              Query SQL (restituire colonne: nome, cognome, email, telefono)
            </label>
            <textarea
              rows={4}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400">
              Mapping colonne DB → CRM (opzionale)
            </label>
            <p className="mt-1 text-xs text-zinc-500">
              Chiave = nome campo CRM, valore = nome colonna nella query
            </p>
            <textarea
              rows={3}
              value={JSON.stringify(mapping, null, 2)}
              onChange={(e) => {
                try {
                  setMapping(JSON.parse(e.target.value))
                } catch {
                  // ignore invalid json while typing
                }
              }}
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 font-mono text-sm text-zinc-100 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
          {result && (
            <div
              className={
                result.imported > 0
                  ? "rounded-md bg-emerald-500/20 p-3 text-sm text-emerald-400"
                  : "rounded-md bg-red-500/20 p-3 text-sm text-red-400"
              }
            >
              Importati: {result.imported}.{" "}
              {result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>... e altri {result.errors.length - 5} errori</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={!connectionString.trim() || !query.trim() || importMutation.isPending}
          >
            {importMutation.isPending ? "Import in corso..." : "Importa"}
          </Button>
        </div>
      </div>
    </div>
  )
}
