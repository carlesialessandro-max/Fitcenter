import { useEffect, useMemo, useRef, useState } from "react"

export type LpagaSearchItem = { id: string; label: string }

type Props = {
  items: LpagaSearchItem[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  required?: boolean
  emptyLabel?: string
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

/** Combobox: filtra l’elenco mentre si digita (non usa la select nativa). */
export function LpagaSearchSelect({
  items,
  value,
  onChange,
  placeholder = "Cerca…",
  className,
  disabled,
  required,
  emptyLabel = "Nessun risultato",
}: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = items.find((i) => i.id === value)
  const t = norm(q)
  const filtered = useMemo(() => {
    const list = t ? items.filter((i) => norm(i.label).includes(t)) : items
    return list.slice(0, 120)
  }, [items, t])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <input
        type="search"
        value={open ? q : (selected?.label ?? "")}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setQ("")
          setOpen(true)
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
      />
      <input type="hidden" value={value} required={required} readOnly />
      {open && !disabled && (
        <ul
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
          role="listbox"
        >
          {filtered.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-800 ${
                  i.id === value ? "bg-amber-500/15 text-amber-100" : "text-zinc-100"
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(i.id)
                  setQ("")
                  setOpen(false)
                }}
              >
                {i.label}
              </button>
            </li>
          ))}
          {!filtered.length && <li className="px-3 py-2 text-sm text-zinc-500">{emptyLabel}</li>}
        </ul>
      )}
    </div>
  )
}

export function MansioneSearchSelect({
  items,
  value,
  onChange,
  className,
  disabled,
  required,
}: {
  items: { id: string; nome: string }[]
  value: string
  onChange: (id: string) => void
  className?: string
  disabled?: boolean
  required?: boolean
}) {
  const mapped = useMemo(
    () =>
      items
        .map((i) => ({ id: i.id, label: i.nome }))
        .sort((a, b) => a.label.localeCompare(b.label, "it")),
    [items]
  )
  return (
    <LpagaSearchSelect
      items={mapped}
      value={value}
      onChange={onChange}
      placeholder="Cerca mansione…"
      className={className}
      disabled={disabled}
      required={required}
      emptyLabel="Nessuna mansione trovata"
    />
  )
}
