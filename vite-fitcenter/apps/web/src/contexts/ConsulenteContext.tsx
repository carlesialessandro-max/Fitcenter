import { createContext, useContext, useState, useCallback, type ReactNode } from "react"

const STORAGE_KEY = "fitcenter-consulente"

const DEFAULT_CONSULENTI = ["Luca Ferrari", "Anna Bianchi"]

type ConsulenteContextType = {
  consulenteNome: string
  setConsulenteNome: (name: string) => void
  consulenti: string[]
}

const defaultValue: ConsulenteContextType = {
  consulenteNome: DEFAULT_CONSULENTI[0] ?? "Consulente",
  setConsulenteNome: () => {},
  consulenti: DEFAULT_CONSULENTI,
}

const ConsulenteContext = createContext<ConsulenteContextType | null>(null)

export function ConsulenteProvider({ children }: { children: ReactNode }) {
  const [consulenteNome, setState] = useState(() => {
    if (typeof window === "undefined") return (DEFAULT_CONSULENTI[0] ?? "")
    return (localStorage.getItem(STORAGE_KEY) || DEFAULT_CONSULENTI[0]) ?? ""
  })

  const setConsulenteNome = useCallback((name: string) => {
    setState(name)
    try {
      localStorage.setItem(STORAGE_KEY, name)
    } catch {}
  }, [])

  return (
    <ConsulenteContext.Provider
      value={{
        consulenteNome,
        setConsulenteNome,
        consulenti: DEFAULT_CONSULENTI,
      }}
    >
      {children}
    </ConsulenteContext.Provider>
  )
}

export function useConsulente(): ConsulenteContextType {
  const ctx = useContext(ConsulenteContext)
  return ctx ?? defaultValue
}
