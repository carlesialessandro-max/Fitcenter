import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { BrandLogo } from "@/components/BrandLogo"
import { getApiBase } from "@/api/baseUrl"

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Disiscrizione() {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState("")

  async function submit(e: FormEvent) {
    e.preventDefault()
    const dest = email.trim()
    if (!EMAIL_OK.test(dest)) {
      setErr("Inserisci un indirizzo email valido")
      return
    }
    setBusy(true)
    setErr("")
    try {
      const res = await fetch(`${getApiBase()}/mail-unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: dest }),
      })
      const text = await res.text().catch(() => "")
      let body: { message?: string } | null = null
      try {
        body = text ? (JSON.parse(text) as { message?: string }) : null
      } catch {
        body = null
      }
      if (!res.ok) throw new Error(body?.message || "Impossibile annullare l'iscrizione")
      setOk(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-svh bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-lg rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <BrandLogo variant="compact" />
          <Link to="/informativa" className="text-sm text-amber-400 hover:underline">
            Privacy Policy
          </Link>
        </div>
        <h1 className="mt-4 text-xl font-semibold">Annulla iscrizione</h1>
        {ok ? (
          <p className="mt-3 text-sm text-zinc-300">
            Iscrizione annullata per <span className="font-medium text-zinc-100">{email.trim()}</span>. Non riceverai più
            comunicazioni da info@h2sport.it.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-400">
              Inserisci l&apos;email su cui non vuoi più ricevere comunicazioni da Aqua Sport SSD a.r.l. / H2Sport.
            </p>
            <form className="mt-4 space-y-3" onSubmit={(e) => void submit(e)}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="la tua email"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                autoComplete="email"
                required
              />
              {err ? <p className="text-sm text-red-400">{err}</p> : null}
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
              >
                {busy ? "Invio…" : "Annulla iscrizione"}
              </button>
            </form>
          </>
        )}
        <p className="mt-6 text-xs text-zinc-500">
          Aqua Sport SSD a.r.l. · Via Prov.le Lucchese, 139/b 51100 Pistoia · P.IVA 01850030477
        </p>
      </div>
    </div>
  )
}
