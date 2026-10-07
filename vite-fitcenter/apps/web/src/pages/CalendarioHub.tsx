import { useEffect, useMemo } from "react"
import { Navigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import {
  CALENDARIO_SEGMENTI,
  calendarioPath,
  roleCanReadCalendarioComparto,
} from "@/pages/calendario-routes"
import { PianoOperativoAdmin } from "@/pages/PianoOperativoAdmin"

export function CalendarioHub() {
  const { role, user } = useAuth()

  const visible = useMemo(() => {
    const all = CALENDARIO_SEGMENTI.filter((x) => roleCanReadCalendarioComparto(role, x.api))
    const pages = user?.pages
    if (!pages?.length) return all
    if (pages.includes("/calendario")) return all
    return all.filter((x) => pages.includes(calendarioPath(x.segmento)))
  }, [role, user?.pages])

  useEffect(() => {
    document.title = "Piano operativo · FitCenter"
  }, [])

  if (role === "admin") {
    return <PianoOperativoAdmin />
  }

  if (role === "calendari") {
    if (visible.length === 1) {
      return <Navigate to={calendarioPath(visible[0]!.segmento)} replace />
    }
    return <PianoOperativoAdmin />
  }

  if (role === "corsi" || role === "istruttore") {
    return <Navigate to={calendarioPath("corsi")} replace />
  }
  if (role === "scuola_nuoto") {
    return <Navigate to={calendarioPath("scuola-nuoto")} replace />
  }
  if (role === "bagnini") {
    return <Navigate to={calendarioPath("piscina")} replace />
  }
  if (role === "danza") {
    return <Navigate to="/danza" replace />
  }
  if (role === "campus") {
    return <Navigate to={calendarioPath("campus")} replace />
  }

  if ((role === "firme" || role === "operatore") && visible.length === 1) {
    return <Navigate to={calendarioPath(visible[0]!.segmento)} replace />
  }

  return <Navigate to="/" replace />
}
