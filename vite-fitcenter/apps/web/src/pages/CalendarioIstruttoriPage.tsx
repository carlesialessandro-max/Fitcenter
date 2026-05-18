import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import type { CalendarioIstruttore } from "@/api/calendario"
import { calendarioApi } from "@/api/calendario"
import { useAuth } from "@/contexts/AuthContext"

const H2 = { blue: "#46A6D9" } as const

function formatCosto(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `€ ${n.toFixed(2)}/h`
}

function PersonalePanel({
  rows,
  canManage,
  onRefresh,
}: {
  rows: CalendarioIstruttore[]
  canManage: boolean
  onRefresh: () => void
}) {
  const [nome, setNome] = useState("")
  const [cognome, setCognome] = useState("")
  const [telefono, setTelefono] = useState("")
  const [email, setEmail] = useState("")
  const [attivitaSvolta, setAttivitaSvolta] = useState("")
  const [costoOrario, setCostoOrario] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function resetForm() {
    setNome("")
    setCognome("")
    setTelefono("")
    setEmail("")
    setAttivitaSvolta("")
    setCostoOrario("")
    setEditId(null)
  }

  function startEdit(r: CalendarioIstruttore) {
    setEditId(r.id)
    setNome(r.nome)
    setCognome(r.cognome)
    setTelefono(r.telefono ?? "")
    setEmail(r.email ?? "")
    setAttivitaSvolta(r.attivitaSvolta ?? "")
    setCostoOrario(r.costoOrario != null ? String(r.costoOrario) : "")
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim() || !cognome.trim()) {
      setErr("Nome e cognome obbligatori")
      return
    }
    const costo = costoOrario.trim() ? Number(costoOrario.replace(",", ".")) : null
    if (costoOrario.trim() && (!Number.isFinite(costo) || costo! < 0)) {
      setErr("Costo orario non valido")
      return
    }
    setErr(null)
    setBusy(true)
    try {
      const body = {
        nome: nome.trim(),
        cognome: cognome.trim(),
        telefono: telefono.trim(),
        email: email.trim(),
        attivitaSvolta: attivitaSvolta.trim(),
        costoOrario: costo,
      }
      if (editId) {
        await calendarioApi.putInstructor(editId, body)
      } else {
        await calendarioApi.postInstructor(body)
      }
      resetForm()
      onRefresh()
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Errore")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm("Eliminare questa persona dall'anagrafica?")) return
    setBusy(true)
    try {
      await calendarioApi.deleteInstructor(id)
      if (editId === id) resetForm()
      onRefresh()
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Errore")
    } finally {
      setBusy(false)
    }
  }

  if (!canManage) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Personale</h2>
        <p className="mt-1 text-xs text-zinc-600">Sola lettura.</p>
        <ul className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto text-sm">
          {rows.map((r) => (
            <li key={r.id} className="rounded border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 text-zinc-300">
              <span className="font-medium">
                {r.cognome} {r.nome}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">
                {r.attivitaSvolta || "—"} · {formatCosto(r.costoOrario)}
              </span>
              <span className="block truncate text-xs text-zinc-500">
                {r.telefono || "—"} · {r.email || "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Anagrafica personale (server)</h2>
      <p className="mt-1 text-xs text-zinc-600">Nome, contatti, attività e costo orario. Usabile nei calendari reparto.</p>
      {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          value={nome}
          onChange={(ev) => setNome(ev.target.value)}
          placeholder="Nome"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={cognome}
          onChange={(ev) => setCognome(ev.target.value)}
          placeholder="Cognome"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={telefono}
          onChange={(ev) => setTelefono(ev.target.value)}
          placeholder="Telefono"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="Email"
          type="email"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={attivitaSvolta}
          onChange={(ev) => setAttivitaSvolta(ev.target.value)}
          placeholder="Attività svolta (es. Bagnino, Reception)"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 sm:col-span-2"
        />
        <input
          value={costoOrario}
          onChange={(ev) => setCostoOrario(ev.target.value)}
          placeholder="Costo orario (€)"
          inputMode="decimal"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
            style={{ backgroundColor: H2.blue }}
          >
            {editId ? "Salva modifiche" : "Aggiungi personale"}
          </button>
          {editId ? (
            <button type="button" onClick={resetForm} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
              Annulla
            </button>
          ) : null}
        </div>
      </form>
      <ul className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-2 rounded border border-zinc-800/80 bg-zinc-950/40 px-3 py-2">
            <span className="min-w-0 text-zinc-300">
              <span className="font-medium">
                {r.cognome} {r.nome}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">
                {r.attivitaSvolta || "—"} · {formatCosto(r.costoOrario)}
              </span>
              <span className="block truncate text-xs text-zinc-500">
                {r.telefono || "—"} · {r.email || "—"}
              </span>
            </span>
            <span className="flex shrink-0 flex-col gap-1">
              <button type="button" onClick={() => startEdit(r)} className="text-xs text-[#46A6D9] hover:underline" disabled={busy}>
                Modifica
              </button>
              <button type="button" onClick={() => void remove(r.id)} className="text-xs text-red-400 hover:underline" disabled={busy}>
                Elimina
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CalendarioIstruttoriPage() {
  const { role } = useAuth()
  const [rows, setRows] = useState<CalendarioIstruttore[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const canAccess =
    role === "admin" ||
    role === "corsi" ||
    role === "istruttore" ||
    role === "scuola_nuoto" ||
    role === "bagnini" ||
    role === "danza" ||
    role === "campus"
  const canManage = role === "admin" || role === "corsi" || role === "operatore" || role === "firme" || role === "bagnini"

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const data = await calendarioApi.listInstructors()
      setRows(data.rows ?? [])
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Errore caricamento")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canAccess) return
    void reload()
  }, [canAccess, reload])

  useEffect(() => {
    document.title = "Piano operativo · Personale"
  }, [])

  if (!canAccess) {
    return (
      <div className="min-h-full bg-zinc-950 p-6 text-zinc-100">
        <p className="text-red-400">Permessi insufficienti.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[#46A6D9]">
          Home
        </Link>
      </div>
    )
  }

  const hub = role === "admin" ? "/calendario" : "/"

  return (
    <div className="min-h-full bg-zinc-950 p-4 text-zinc-100 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Piano operativo · Personale</h1>
            <p className="mt-1 text-sm text-zinc-500">Anagrafica condivisa per i calendari reparto.</p>
            {loadErr ? <p className="mt-2 text-xs text-red-400">{loadErr}</p> : null}
            {loading ? <p className="mt-2 text-xs text-zinc-500">Caricamento…</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={hub} className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
              {role === "admin" ? "Piano operativo" : "Home"}
            </Link>
            {role === "admin" ? (
              <Link to="/" className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Dashboard vendite
              </Link>
            ) : null}
          </div>
        </header>
        <PersonalePanel rows={rows} canManage={canManage} onRefresh={() => void reload()} />
      </div>
    </div>
  )
}
