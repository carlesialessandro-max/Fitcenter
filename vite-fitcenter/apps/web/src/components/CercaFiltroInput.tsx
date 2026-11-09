import { useEffect, useRef, useState } from "react"

/** Campo di ricerca con valore locale: la lista si aggiorna dopo una breve pausa, senza bloccare la digitazione. */
export function CercaFiltroInput({
  value,
  onChange,
  placeholder,
  className,
  delayMs = 150,
}: {
  value: string
  onChange: (s: string) => void
  placeholder?: string
  className?: string
  delayMs?: number
}) {
  const [local, setLocal] = useState(value)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    setLocal(value)
  }, [value])

  useEffect(() => {
    if (local === value) return
    const t = window.setTimeout(() => onChangeRef.current(local), delayMs)
    return () => window.clearTimeout(t)
  }, [local, value, delayMs])

  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
      className={className}
      autoComplete="off"
      spellCheck={false}
    />
  )
}
