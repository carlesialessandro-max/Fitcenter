import { useMemo, useState } from "react"

type Item = { id: string; nome: string }

type Props = {
  items: Item[]
  value: string
  onChange: (id: string) => void
  className?: string
  disabled?: boolean
  required?: boolean
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

export function MansioneSearchSelect({ items, value, onChange, className, disabled, required }: Props) {
  const [q, setQ] = useState("")
  const filtered = useMemo(() => {
    const t = norm(q)
    if (!t) return items
    return items.filter((i) => norm(i.nome).includes(t) || i.id === value)
  }, [items, q, value])

  return (
    <div className={className}>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cerca mansione…"
        disabled={disabled}
        className="mb-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
        autoComplete="off"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
        disabled={disabled}
        required={required}
      >
        <option value="">Seleziona mansione</option>
        {filtered.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nome}
          </option>
        ))}
      </select>
    </div>
  )
}
