import { Outlet, Link, useLocation } from "react-router-dom"
import { cn } from "@workspace/ui/lib/utils"
import { useAuth } from "@/contexts/AuthContext"

const navOperatore = [
  { to: "/", label: "Dashboard" },
  { to: "/firme", label: "Firme" },
  { to: "/crm", label: "CRM Vendita" },
  { to: "/telefonate", label: "Telefonate" },
  { to: "/abbonamenti", label: "Abbonamenti in Scadenza" },
  { to: "/andamento-vendite", label: "Andamento Vendite" },
] as const

const navAdmin = [
  { to: "/", label: "Dashboard" },
  { to: "/convalide-consulenti", label: "Convalide" },
  { to: "/attivi-analisi", label: "Attivi" },
  { to: "/firme", label: "Firme" },
  { to: "/crm", label: "CRM Vendita" },
  { to: "/telefonate", label: "Telefonate" },
  { to: "/abbonamenti", label: "Abbonamenti in Scadenza" },
  { to: "/andamento-vendite", label: "Andamento Vendite" },
] as const

export function AppLayout() {
  const location = useLocation()
  const { user, role, logout, leadFilter } = useAuth()
  const nav =
    leadFilter === "bambini"
      ? [{ to: "/crm" as const, label: "CRM Vendita" }]
      : role === "admin"
        ? navAdmin
        : navOperatore

  return (
    <div className="flex min-h-svh bg-zinc-950 text-zinc-100">
      <aside className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-900/50">
        <div className="flex h-14 flex-col justify-center border-b border-zinc-800 px-4">
          <span className="font-semibold tracking-tight text-amber-400">FitCenter</span>
          <span className="text-xs text-zinc-500">Gestione Centro</span>
        </div>
        <div className="border-b border-zinc-800 px-3 py-2">
          <p className="text-xs text-zinc-500">Connesso come</p>
          <p className="mt-0.5 truncate text-sm font-medium text-zinc-200" title={user?.nome}>
            {user?.nome ?? "—"}
          </p>
          <p className="text-xs text-zinc-500">
            {role === "admin" ? "Admin" : "Operatore"}
          </p>
          <button
            type="button"
            onClick={() => logout()}
            className="mt-2 w-full rounded border border-zinc-600 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Esci
          </button>
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
