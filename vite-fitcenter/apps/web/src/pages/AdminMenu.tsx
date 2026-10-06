import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { ADMIN_MENU_GROUPS } from "@/lib/admin-menu"

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

export function AdminMenu() {
  const { user } = useAuth()
  const [q, setQ] = useState("")
  const custom = (user?.pages?.length ?? 0) > 0
  const allow = useMemo(() => {
    if (!custom) return null
    return new Set(["/", "/dashboard", "/libro-paga", ...(user?.pages ?? [])])
  }, [custom, user?.pages])

  const groups = useMemo(() => {
    const t = norm(q)
    return ADMIN_MENU_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        if (allow && !allow.has(i.to)) return false
        if (!t) return true
        return norm(i.label).includes(t) || norm(g.title).includes(t)
      }),
    })).filter((g) => g.items.length)
  }, [allow, q])

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Menu</h1>
          <p className="mt-1 text-sm text-zinc-500">Scegli una pagina. Il menu a sinistra resta ridotto a Home.</p>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca pagina…"
          className="w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
        />
      </div>
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.items.map((i) => (
                <Link
                  key={i.to}
                  to={i.to}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm font-medium text-zinc-100 transition-colors hover:border-amber-500/40 hover:bg-zinc-900 hover:text-amber-200"
                >
                  {i.label}
                </Link>
              ))}
            </div>
          </section>
        ))}
        {!groups.length && <p className="text-sm text-zinc-500">Nessuna pagina trovata.</p>}
      </div>
    </div>
  )
}
