import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { corsiGestioneApi, type CorsiClienteSearchHit } from "@/api/corsiGestione"

type Props = {
  disabled?: boolean
  onPick: (hit: CorsiClienteSearchHit) => void
  onGuest: (cognome: string, nome: string) => void
}

export function CorsiAggiungiCliente({ disabled, onPick, onGuest }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [debounced, setDebounced] = useState("")
  const [guestCognome, setGuestCognome] = useState("")
  const [guestNome, setGuestNome] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 280)
    return () => clearTimeout(t)
  }, [q])

  const searchQ = useQuery({
    queryKey: ["corsi-clienti-search", debounced],
    queryFn: () => corsiGestioneApi.searchClienti(debounced),
    enabled: open && debounced.length >= 2 && !disabled,
    staleTime: 15_000,
  })

  const rows = searchQ.data?.rows ?? []

  function close() {
    setOpen(false)
    setQ("")
    setDebounced("")
    setGuestCognome("")
    setGuestNome("")
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="touch-manipulation rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Aggiungi cliente
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-zinc-950/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-amber-200">Ingresso senza prenotazione</div>
        <button type="button" onClick={close} className="text-xs text-zinc-400 hover:text-zinc-200">
          Chiudi
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Cerca in anagrafica (cognome, nome o tessera). Il cliente resta sul corso con pallino giallo.
      </p>
      <input
        type="search"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cerca cognome, nome o tessera…"
        className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        autoComplete="off"
        autoFocus
      />
      {debounced.length >= 2 ? (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-800">
          {searchQ.isFetching ? (
            <div className="px-3 py-2 text-xs text-zinc-500">Ricerca…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">Nessun cliente trovato.</div>
          ) : (
            rows.map((hit) => (
              <button
                key={hit.id || `${hit.cognome}-${hit.nome}`}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(hit)
                  close()
                }}
                className="flex w-full flex-col items-start border-b border-zinc-800 px-3 py-2 text-left last:border-0 hover:bg-zinc-900"
              >
                <span className="text-sm font-medium text-zinc-100">
                  {hit.cognome} {hit.nome}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {[hit.tessera ? `Tessera ${hit.tessera}` : null, hit.telefono, hit.email].filter(Boolean).join(" · ") ||
                    "Anagrafica gestionale"}
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-600">Scrivi almeno 2 caratteri.</p>
      )}
      <div className="mt-3 border-t border-zinc-800 pt-3">
        <div className="text-xs font-medium text-zinc-400">Non in anagrafica</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            value={guestCognome}
            disabled={disabled}
            onChange={(e) => setGuestCognome(e.target.value)}
            placeholder="Cognome"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
          <input
            value={guestNome}
            disabled={disabled}
            onChange={(e) => setGuestNome(e.target.value)}
            placeholder="Nome"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <button
          type="button"
          disabled={disabled || (!guestCognome.trim() && !guestNome.trim())}
          onClick={() => {
            onGuest(guestCognome.trim(), guestNome.trim())
            close()
          }}
          className="mt-2 rounded-lg border border-zinc-600 bg-zinc-800/70 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
        >
          Aggiungi ospite
        </button>
      </div>
    </div>
  )
}
