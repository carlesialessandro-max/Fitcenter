import { useEffect } from "react"
import { Link, Navigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { CALENDARIO_SEGMENTI, calendarioPath, roleCanReadCalendarioComparto } from "@/pages/calendario-routes"

export function CalendarioHub() {
  const { role } = useAuth()

  const visible = CALENDARIO_SEGMENTI.filter((x) => roleCanReadCalendarioComparto(role, x.api))

  useEffect(() => {
    document.title = "Piano operativo · FitCenter"
  }, [])

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

  if (role !== "admin") {
    return <Navigate to="/" replace />
  }

  return (
    <div className="min-h-full bg-zinc-950 p-4 text-zinc-100 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Piano operativo</h1>
          <p className="text-sm text-zinc-500">
            Scegli il reparto per aprire il calendario. I dati modificati (istruttori, note) sono salvati sul server e visibili a tutti gli utenti autorizzati.
          </p>
          <Link
            to="/"
            className="inline-flex rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            ← Dashboard vendite
          </Link>
        </header>

        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((x) => (
            <li key={x.segmento}>
              <Link
                to={calendarioPath(x.segmento)}
                className="block rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-[#46A6D9]/40 hover:bg-zinc-900"
              >
                <span className="text-sm font-medium text-zinc-200">{x.label}</span>
                <span className="mt-1 block text-xs text-zinc-500">Apri calendario</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
