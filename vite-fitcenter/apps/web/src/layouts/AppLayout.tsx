import { useEffect, useState } from "react"
import { Outlet, Link, useLocation, Navigate } from "react-router-dom"
import { cn } from "@workspace/ui/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import { BrandLogo } from "@/components/BrandLogo"

type NavItem = { to: string; label: string; children?: NavItem[]; group?: boolean; groupKey?: string }

const navOperatore: NavItem[] = [
  { to: "/", label: "Dashboard", children: [{ to: "/referral", label: "Referral" }] },
  { to: "/firme", label: "Firme" },
  { to: "/firma-cassa", label: "Firma Cassa" },
  { to: "/crm", label: "CRM Vendita" },
  { to: "/telefonate", label: "Telefonate" },
  { to: "/abbonamenti", label: "Abbonamenti in Scadenza" },
  { to: "/andamento-vendite", label: "Andamento Vendite" },
  { to: "/piscina", label: "Mappa Piscina" },
] as const

const navCorsi: NavItem[] = [
  { to: "/corsi", label: "Corsi", children: [{ to: "/corsi/assenze", label: "Assenze (mese)" }, { to: "/calendario/corsi", label: "Calendario corsi" }] },
] as const
const navIstruttore: NavItem[] = [{ to: "/corsi", label: "Corsi", children: [{ to: "/calendario/corsi", label: "Calendario corsi" }] }] as const
const navCampus: NavItem[] = [{ to: "/campus", label: "Campus" }] as const
// Reception: solo firma da cassa (no dashboard, no admin firme).
const navFirme: NavItem[] = [{ to: "/firma-cassa", label: "Firma Cassa", children: [{ to: "/campus", label: "Campus" }] }] as const
const navScuolaNuoto: NavItem[] = [
  { to: "/scuola-nuoto", label: "Scuola Nuoto", children: [{ to: "/calendario/scuola-nuoto", label: "Calendario scuola nuoto" }] },
] as const
const navBagnini: NavItem[] = [{ to: "/piscina", label: "Mappa Piscina" }] as const
const navDanza: NavItem[] = [{ to: "/danza", label: "Danza" }] as const

const navAdmin: NavItem[] = [
  {
    to: "__vendite_group__",
    label: "Vendite",
    group: true,
    groupKey: "vendite",
    children: [
      { to: "/", label: "Dashboard" },
      { to: "/stampa-report", label: "Stampa report" },
      { to: "/referral", label: "Referral" },
      { to: "/convalide-consulenti", label: "Convalide" },
      { to: "/attivi-analisi", label: "Attivi" },
      { to: "/crm", label: "CRM vendita" },
      { to: "/telefonate", label: "Telefonate" },
      { to: "/abbonamenti", label: "Abbonamenti in scadenza" },
      { to: "/andamento-vendite", label: "Andamento vendite" },
    ],
  },
  { to: "/calendario", label: "Piano operativo" },
  { to: "/corsi", label: "Corsi", children: [{ to: "/corsi/assenze", label: "Assenze (mese)" }, { to: "/calendario/corsi", label: "Calendario corsi" }] },
  {
    to: "__admin_group__",
    label: "Altri",
    group: true,
    groupKey: "admin",
    children: [
      { to: "/incassi", label: "Incassi" },
      { to: "/firme", label: "Firme" },
      { to: "/firma-cassa", label: "Firma cassa" },
      { to: "/piscina", label: "Mappa piscina" },
      { to: "/scuola-nuoto", label: "Scuola nuoto" },
      { to: "/calendario/scuola-nuoto", label: "Calendario scuola nuoto" },
      { to: "/campus", label: "Campus" },
      { to: "/danza", label: "Danza" },
    ],
  },
] as const

export function AppLayout() {
  const location = useLocation()
  const { user, role, logout, leadFilter } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({ vendite: true, admin: true })
  const mustRedirectBagnini = role === "bagnini" && !location.pathname.startsWith("/piscina")
  const nav: NavItem[] =
    leadFilter === "bambini"
      ? [{ to: "/crm" as const, label: "CRM Vendita" }]
      : role === "admin"
        ? navAdmin
        : role === "corsi"
          ? navCorsi
          : role === "istruttore"
            ? navIstruttore
            : role === "campus"
              ? navCampus
              : role === "firme"
                ? navFirme
                : role === "scuola_nuoto"
                  ? navScuolaNuoto
                  : role === "bagnini"
                    ? navBagnini
                    : role === "danza"
                      ? navDanza
              : navOperatore

  const Sidebar = (
    <aside className="flex h-full w-72 flex-col border-r border-zinc-800 bg-zinc-900/95 sm:w-56 sm:bg-zinc-900/50">
      <div className="flex min-h-[4.5rem] flex-col justify-center gap-1 border-b border-zinc-800 px-3 py-2">
        <Link to="/" className="block outline-none ring-offset-2 ring-offset-zinc-900 focus-visible:ring-2 focus-visible:ring-[#46A6D9]" onClick={() => setMobileOpen(false)}>
          <BrandLogo variant="compact" />
        </Link>
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">FitCenter · gestione</span>
      </div>
      <div className="border-b border-zinc-800 px-3 py-2">
        <p className="text-xs text-zinc-500">Connesso come</p>
        <p className="mt-0.5 truncate text-sm font-medium text-zinc-200" title={user?.nome}>
          {user?.nome ?? "—"}
        </p>
        <p className="text-xs text-zinc-500">
          {role === "admin"
            ? "Admin"
            : role === "firme"
              ? "Firme"
              : role === "corsi"
                ? "Corsi"
                : role === "istruttore"
                  ? "Istruttore"
                  : role === "campus"
                    ? "Campus"
                    : role === "scuola_nuoto"
                      ? "Scuola Nuoto"
            : role === "bagnini"
              ? "Bagnini"
              : role === "danza"
                ? "Danza"
                    : "Operatore"}
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
        {nav.map(({ to, label, children, group, groupKey }) => (
          <div key={to}>
            {group ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const key = groupKey ?? "admin"
                    setGroupOpen((prev) => {
                      const next = { ...prev, [key]: !prev[key] }
                      try {
                        localStorage.setItem("fitcenter-nav-groups", JSON.stringify(next))
                        if (key === "admin") {
                          localStorage.setItem("fitcenter-nav-admin-open", next.admin ? "1" : "0")
                        }
                      } catch {}
                      return next
                    })
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    (groupOpen[groupKey ?? "admin"] ?? true) ? "text-zinc-200 hover:bg-zinc-800" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  )}
                  aria-expanded={groupOpen[groupKey ?? "admin"] ?? true}
                >
                  <span>{label}</span>
                  <span className="text-xs text-zinc-500">{(groupOpen[groupKey ?? "admin"] ?? true) ? "▾" : "▸"}</span>
                </button>
                {(groupOpen[groupKey ?? "admin"] ?? true) && children?.length ? (
                  <div className="mt-1 flex flex-col gap-0.5 pl-2">
                    {children.map((c) => (
                      <Link
                        key={c.to}
                        to={c.to}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          location.pathname === c.to || (c.to !== "/" && location.pathname.startsWith(c.to))
                            ? "bg-amber-500/20 text-amber-400"
                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        )}
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <Link
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    location.pathname === to || (to !== "/" && location.pathname.startsWith(to))
                      ? "bg-amber-500/20 text-amber-400"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  )}
                >
                  {label}
                </Link>
                {children?.length ? (
                  <div className="mt-1 flex flex-col gap-0.5 pl-2">
                    {children.map((c) => (
                      <Link
                        key={c.to}
                        to={c.to}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          location.pathname === c.to || (c.to !== "/" && location.pathname.startsWith(c.to))
                            ? "bg-amber-500/20 text-amber-400"
                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        )}
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )

  useEffect(() => {
    try {
      const raw = localStorage.getItem("fitcenter-nav-groups")
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>
        if (parsed && typeof parsed === "object") {
          setGroupOpen((prev) => ({ ...prev, ...parsed }))
          return
        }
      }
      const legacy = localStorage.getItem("fitcenter-nav-admin-open")
      if (legacy != null) {
        setGroupOpen((prev) => ({ ...prev, admin: legacy !== "0" }))
      }
    } catch {
      setGroupOpen({ vendite: true, admin: true })
    }
  }, [])

  // Importante: redirect dopo gli hooks (evita crash React #310 in prod).
  if (mustRedirectBagnini) return <Navigate to="/piscina" replace />

  return (
    <div className="flex min-h-svh flex-col bg-zinc-950 text-zinc-100 sm:flex-row">
      {/* Sidebar desktop: colonna fissa */}
      <div className="hidden shrink-0 sm:block">{Sidebar}</div>

      {/* Mobile: colonna verticale (topbar + main) — evita flex-row che schiaccia il main */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-3 backdrop-blur sm:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            aria-label="Apri menu"
          >
            Menu
          </button>
          <Link to="/" className="min-w-0 shrink-0" onClick={() => setMobileOpen(false)}>
            <BrandLogo variant="compact" className="max-w-[120px]" imgClassName="h-8" />
          </Link>
          <div className="min-w-0 flex-1 text-right">
            <div className="truncate text-[11px] font-medium text-zinc-400">FitCenter</div>
            <div className="truncate text-[11px] text-zinc-500">{user?.nome ?? "—"}</div>
          </div>
        </div>

        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Drawer mobile (fixed, non nel flusso flex) */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-label="Chiudi menu"
          />
          <div className="absolute left-0 top-0 h-full w-[85vw] max-w-sm shadow-2xl">{Sidebar}</div>
        </div>
      ) : null}
    </div>
  )
}
