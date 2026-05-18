import { useMemo, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"
import type { CalendarioIstruttore } from "@/api/calendario"

type Props = {
  instructors: CalendarioIstruttore[]
  value: string
  onChange: (id: string) => void
  className?: string
  disabled?: boolean
}

function normSearch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

export function InstructorSearchSelect({ instructors, value, onChange, className, disabled }: Props) {
  const [q, setQ] = useState("")
  const searching = normSearch(q).length > 0

  const filtered = useMemo(() => {
    const t = normSearch(q)
    if (!t) return instructors
    return instructors.filter((i) => {
      const cognome = normSearch(i.cognome)
      const nome = normSearch(i.nome)
      const label = `${cognome} ${nome}`.trim()
      return label.includes(t) || cognome.includes(t) || nome.includes(t)
    })
  }, [instructors, q])

  const selected = instructors.find((i) => i.id === value)

  return (
    <div className={className}>
      <input
        type="search"
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        placeholder="Cerca cognome o nome…"
        disabled={disabled}
        className="mb-2 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        autoComplete="off"
      />
      {selected && !searching ? (
        <p className="mb-2 text-xs text-zinc-400">
          Selezionato:{" "}
          <span className="text-zinc-200">
            {selected.cognome} {selected.nome}
          </span>
        </p>
      ) : null}
      {searching ? (
        <div
          className="max-h-52 overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-950"
          role="listbox"
          aria-label="Risultati ricerca personale"
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange("")
              setQ("")
            }}
            className="w-full border-b border-zinc-800 px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-900"
          >
            — Nessuno (usa testo sotto) —
          </button>
          {filtered.map((ins) => (
            <button
              key={ins.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(ins.id)
                setQ("")
              }}
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover:bg-zinc-900",
                value === ins.id ? "bg-emerald-950/50 text-emerald-100" : "text-zinc-100"
              )}
            >
              {ins.cognome} {ins.nome}
            </button>
          ))}
        </div>
      ) : (
        <select
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        >
          <option value="">— Nessuno (usa testo sotto) —</option>
          {instructors.map((ins) => (
            <option key={ins.id} value={ins.id}>
              {ins.cognome} {ins.nome}
            </option>
          ))}
        </select>
      )}
      {searching && filtered.length === 0 ? (
        <p className="mt-1 text-[11px] text-amber-400/90">Nessun risultato. Aggiungi l&apos;istruttore in Anagrafica.</p>
      ) : null}
    </div>
  )
}
