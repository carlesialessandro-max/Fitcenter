import { useMemo, useState } from "react"
import type { CalendarioIstruttore } from "@/api/calendario"

type Props = {
  instructors: CalendarioIstruttore[]
  value: string
  onChange: (id: string) => void
  className?: string
  disabled?: boolean
}

export function InstructorSearchSelect({ instructors, value, onChange, className, disabled }: Props) {
  const [q, setQ] = useState("")

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return instructors
    return instructors.filter((i) => {
      const label = `${i.cognome} ${i.nome}`.toLowerCase()
      return label.includes(t) || i.cognome.toLowerCase().includes(t) || i.nome.toLowerCase().includes(t)
    })
  }, [instructors, q])

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
      <select
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        size={filtered.length > 8 ? 8 : undefined}
      >
        <option value="">— Nessuno (usa testo sotto) —</option>
        {filtered.map((ins) => (
          <option key={ins.id} value={ins.id}>
            {ins.cognome} {ins.nome}
          </option>
        ))}
      </select>
      {q.trim() && filtered.length === 0 ? (
        <p className="mt-1 text-[11px] text-amber-400/90">Nessun risultato. Aggiungi l&apos;istruttore in Anagrafica.</p>
      ) : null}
    </div>
  )
}
