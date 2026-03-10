import { Outlet, Link, useLocation } from "react-router-dom"
import { cn } from "@workspace/ui/lib/utils"
import { useConsulente } from "@/contexts/ConsulenteContext"

const nav = [
  { to: "/", label: "Dashboard" },
  { to: "/crm", label: "CRM Vendita" },
  { to: "/abbonamenti", label: "Abbonamenti" },
  { to: "/clienti", label: "Clienti" },
] as const

export function AppLayout() {
  const location = useLocation()
  const { consulenteNome, setConsulenteNome, consulenti } = useConsulente()

  return (
    <div className="flex min-h-svh bg-zinc-950 text-zinc-100">
      <aside className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-900/50">
        <div className="flex h-14 flex-col justify-center border-b border-zinc-800 px-4">
          <span className="font-semibold tracking-tight text-amber-400">FitCenter</span>
          <span className="text-xs text-zinc-500">Gestione Centro</span>
        </div>
        <div className="border-b border-zinc-800 px-3 py-2">
          <label className="block text-xs text-zinc-500 mb-1">Operatore</label>
          <select
            value={consulenteNome}
            onChange={(e) => setConsulenteNome(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
          >
            {consulenti.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {nav.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                location.pathname === to || (to !== "/" && location.pathname.startsWith(to))
                  ? "bg-amber-500/20 text-amber-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
