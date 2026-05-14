import { Navigate } from "react-router-dom"

/** Compat: vecchio URL /admin → hub reparti calendario. */
export function AdminCalendario() {
  return <Navigate to="/calendario" replace />
}
