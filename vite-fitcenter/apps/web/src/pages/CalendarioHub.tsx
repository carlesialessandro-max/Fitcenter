import { useEffect, useMemo } from "react"
import { Link, Navigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import {
  CALENDARIO_SEGMENTI,
  calendarioPath,
  roleCanReadCalendarioComparto,
  type CalendarioSegmento,
} from "@/pages/calendario-routes"
import { PianoOperativoAdmin } from "@/pages/PianoOperativoAdmin"

function CalendariIndex({
  items,
}: {
  items: { segmento: CalendarioSegmento; label: string }[]
}) {
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Calendari</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Solo visualizzazione. I responsabili modificano gli orari dal proprio accesso (reception, bagnini, corsi, …).
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <Link
            key={i.segmento}
            to={calendarioPath(i.segmento)}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm font-medium text-zinc-100 transition-colors hover:border-[#46A6D9]/50 hover:bg-zinc-900"
          >
            {i.label}
          </Link>
        ))}
        <Link
          to="/calendario/personale"
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm font-medium text-zinc-100 transition-colors hover:border-[#46A6D9]/50 hover:bg-zinc-900"
        >
          Personale
        </Link>
      </div>
    </div>
  )
}

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
    return <CalendariIndex items={visible} />
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
