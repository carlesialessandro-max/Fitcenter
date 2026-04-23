import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { authApi, type User } from "@/api/auth"
import { setAuthToken } from "@/api/client"

const DEFAULT_CONSULENTI = ["Carmen Severino", "Ombretta Zenoni", "Serena Del Prete"]

export type Role = "admin" | "operatore" | "firme" | "corsi" | "istruttore" | "campus" | "scuola_nuoto"

type AuthContextType = {
  isAuthenticated: boolean
  isLoading: boolean
  user: User | null
  /** Dopo POST /auth/login o /auth/login/otp */
  applySession: (token: string, user: User) => void
  logout: () => Promise<void>
  /** Per compatibilità: ruolo dell'utente loggato */
  role: Role
  /** Nome consulente (operatore) o undefined se admin */
  consulenteNome: string
  /** Per chiamate API: se operatore, passa questo; se admin, undefined */
  consulenteFilter: string | undefined
  consulenti: string[]
  /** Se "bambini": consulente bambini, vede solo CRM con lead BAMBINI */
  leadFilter?: "bambini"
}

const defaultValue: AuthContextType = {
  isAuthenticated: false,
  isLoading: true,
  user: null,
  applySession: () => {},
  logout: async () => {},
  role: "operatore",
  consulenteNome: DEFAULT_CONSULENTI[0] ?? "",
  consulenteFilter: undefined,
  consulenti: DEFAULT_CONSULENTI,
  leadFilter: undefined,
}

const AuthContext = createContext<AuthContextType | null>(null)

function getStoredToken(): string | null {
  try {
    return localStorage.getItem("fitcenter-token")
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const restoreSession = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setUser(null)
      setIsLoading(false)
      return
    }
    try {
      const { user: u } = await authApi.me()
      setUser(u)
    } catch {
      setUser(null)
      setAuthToken(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  const applySession = useCallback((token: string, u: User) => {
    setAuthToken(token)
    setUser(u)
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setUser(null)
  }, [])

  const role = user?.role ?? "operatore"
  const consulenteNome = user?.consulenteNome ?? user?.nome ?? ""
  const consulenteFilter = role === "operatore" ? (consulenteNome || undefined) : undefined

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!user,
        isLoading,
        user,
        applySession,
        logout,
        role,
        consulenteNome,
        consulenteFilter,
        consulenti: DEFAULT_CONSULENTI,
        leadFilter: user?.leadFilter,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  return ctx ?? defaultValue
}

/** Per compatibilità: chi effettua le chiamate (nome consulente) */
export function useConsulente() {
  const auth = useAuth()
  return {
    consulenteNome: auth.consulenteNome,
    setConsulenteNome: () => {},
    consulenti: auth.consulenti,
  }
}
