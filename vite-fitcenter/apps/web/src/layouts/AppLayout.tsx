import { useEffect, useState } from "react"
import { Outlet, Link, useLocation, Navigate } from "react-router-dom"
import { cn } from "@workspace/ui/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import { BrandLogo } from "@/components/BrandLogo"
import { PwaInstallHint } from "@/components/PwaInstallHint"

type NavItem = { to: string; label: string; children?: NavItem[]; group?: boolean; groupKey?: string }

const navLezioniPrivateGroup: NavItem = {
  to: "__lp_group__",
  label: "Lezioni private",
  group: true,
  groupKey: "lp",
  children: [
    { to: "/lezioni-private/richieste", label: "Richieste" },
    { to: "/lezioni-private/calendario", label: "Calendario vasche" },
    { to: "/lezioni-private/istruttori", label: "Istruttori / regole" },
    { to: "/lezioni-private/abbonamenti", label: "Controllo abbonamenti" },
  ],
}

const navOperatore: NavItem[] = [
    { to: "/", label: "Dashboard", children: [{ to: "/referral", label: "Referral" }] },
    { to: "/firme", label: "Firme" },
    { to: "/firma-cassa", label: "Firma Cassa" },
    { to: "/scontrini", label: "Scontrini" },
    { to: "/incassi", label: "Incassi" },
    { to: "/calendario/reception", label: "Calendario reception" },
    { to: "/crm", label: "CRM Vendita" },
    { to: "/crm/whatsapp-log", label: "Log WhatsApp" },
    { to: "/telefonate", label: "Telefonate" },
    { to: "/stampa-report", label: "Stampa report" },
    { to: "/abbonamenti", label: "Abbonamenti in Scadenza" },
    { to: "/andamento-vendite", label: "Andamento Vendite" },
    { to: "/andamento-vendite-bambini", label: "Andamento vendite bambini" },
    { to: "/vendite-cross", label: "Cross" },
    { to: "/piscina", label: "Mappa Piscina" },
    navLezioniPrivateGroup,
  ] as const

const navCorsi: NavItem[] = [
  {
    to: "__piano_group__",
    label: "Piano operativo",
    group: true,
    groupKey: "piano",
    children: [
      { to: "/calendario/corsi", label: "Calendario corsi" },
      { to: "/calendario/personale", label: "Personale" },
    ],
  },
  { to: "/corsi", label: "Corsi", children: [{ to: "/corsi/presenze", label: "Presenze" }, { to: "/corsi/nuoto-libero", label: "Nuoto libero" }, { to: "/corsi/assenze", label: "Assenze (mese)" }] },
] as const
const navIstruttore: NavItem[] = [
  {
    to: "__piano_group__",
    label: "Piano operativo",
    group: true,
    groupKey: "piano",
    children: [
      { to: "/calendario/corsi", label: "Calendario corsi" },
      { to: "/calendario/personale", label: "Personale" },
    ],
  },
  { to: "/corsi", label: "Corsi", children: [{ to: "/corsi/presenze", label: "Presenze" }] },
  navLezioniPrivateGroup,
] as const
const navCampus: NavItem[] = [
  {
    to: "__piano_group__",
    label: "Piano operativo",
    group: true,
    groupKey: "piano",
    children: [
      { to: "/calendario/campus", label: "Calendario campus" },
      { to: "/calendario/personale", label: "Personale" },
    ],
  },
  { to: "/campus", label: "Campus" },
] as const
// Reception: firma da cassa, calendario e mappa piscina.
const navFirme: NavItem[] = [
  {
    to: "/firma-cassa",
    label: "Firma Cassa",
    children: [
      { to: "/scontrini", label: "Scontrini" },
      { to: "/campus", label: "Campus" },
    ],
  },
  { to: "/calendario/reception", label: "Calendario reception" },
  { to: "/piscina", label: "Mappa Piscina" },
  navLezioniPrivateGroup,
] as const
const navScuolaNuoto: NavItem[] = [
  {
    to: "__piano_group__",
    label: "Piano operativo",
    group: true,
    groupKey: "piano",
    children: [
      { to: "/calendario/scuola-nuoto", label: "Calendario scuola nuoto" },
      { to: "/calendario/personale", label: "Personale" },
    ],
  },
  {
    to: "/scuola-nuoto",
    label: "Scuola Nuoto",
    children: [{ to: "/scuola-nuoto/note", label: "Archivio note" }],
  },
  { to: "/andamento-vendite-bambini", label: "Andamento vendite bambini" },
  navLezioniPrivateGroup,
] as const
const navBagnini: NavItem[] = [
  {
    to: "__piano_group__",
    label: "Piano operativo",
    group: true,
    groupKey: "piano",
    children: [
      { to: "/calendario/piscina", label: "Calendario bagnini" },
      { to: "/calendario/personale", label: "Personale" },
    ],
  },
  { to: "/piscina", label: "Mappa Piscina" },
  { to: "/corsi/nuoto-libero", label: "Nuoto libero" },
] as const
const navDanza: NavItem[] = [
  {
    to: "__piano_group__",
    label: "Piano operativo",
    group: true,
    groupKey: "piano",
    children: [{ to: "/calendario/personale", label: "Personale" }],
  },
  { to: "/danza", label: "Danza" },
] as const
const navCrm: NavItem[] = [
  { to: "/crm", label: "CRM Vendita" },
  { to: "/crm/whatsapp-log", label: "Log WhatsApp" },
]

const navAdmin: NavItem[] = [{ to: "/", label: "Menu" }]

function isRealPath(to: string): boolean {
  return !!to && !to.startsWith("__")
}

function isPathAllowed(pathname: string, pages: string[]): boolean {
  for (const p of pages) {
    if (pathname === p) return true
    if (p !== "/" && pathname.startsWith(p + "/")) return true
  }
  return false
}

function filterNavByPages(items: NavItem[], pages: string[]): NavItem[] {
  const allow = new Set(pages)
  const out: NavItem[] = []
  for (const item of items) {
    if (item.group && item.children?.length) {
      const children = filterNavByPages(item.children, pages)
      if (children.length) out.push({ ...item, children })
      continue
    }
    const selfOk = isRealPath(item.to) && allow.has(item.to)
    const children = item.children?.length ? filterNavByPages(item.children, pages) : []
    if (selfOk || children.length) {
      out.push(children.length ? { ...item, children } : { ...item })
    }
  }
  return out
}

function excludeNavPath(items: NavItem[], path: string): NavItem[] {
  const out: NavItem[] = []
  for (const item of items) {
    if (item.to === path) continue
    if (item.children?.length) {
      const children = excludeNavPath(item.children, path)
      if (item.group) {
        if (children.length) out.push({ ...item, children })
        continue
      }
      out.push(children.length ? { ...item, children } : { ...item, children: undefined })
      continue
    }
    out.push(item)
  }
  return out
}

function firstNavPath(items: NavItem[]): string {
  for (const item of items) {
    if (item.group && item.children?.length) {
      const nested = firstNavPath(item.children)
      if (nested) return nested
      continue
    }
    if (isRealPath(item.to)) return item.to
    if (item.children?.length) {
      const nested = firstNavPath(item.children)
      if (nested) return nested
    }
  }
  return "/"
}

export function AppLayout() {
  const location = useLocation()
  const { user, role, logout, leadFilter } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({ vendite: true, admin: true, piano: true, lp: true })
  const customPages = (user?.pages?.length ?? 0) > 0
  const mustRedirectBagnini =
    !customPages &&
    role === "bagnini" &&
    !location.pathname.startsWith("/piscina") &&
    location.pathname !== "/calendario/piscina" &&
    location.pathname !== "/calendario/personale" &&
    location.pathname !== "/calendario/istruttori" &&
    location.pathname !== "/corsi/nuoto-libero"
  const mustRedirectCrm =
    !customPages &&
    role === "crm" &&
    location.pathname !== "/crm" &&
    !location.pathname.startsWith("/crm/lead/") &&
    location.pathname !== "/crm/whatsapp-log" &&
    location.pathname !== "/crm/nuovo"
  const roleNav: NavItem[] =
    leadFilter === "bambini" || role === "crm"
      ? navCrm
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
  const pagesForNav =
    customPages && role === "admin"
      ? [...new Set(["/", "/dashboard", "/libro-paga", ...(user!.pages ?? [])])]
      : user?.pages
  const navBase: NavItem[] = customPages ? filterNavByPages(roleNav, pagesForNav!) : roleNav
  const nav: NavItem[] =
    role !== "admin" && user?.vedeTotaliCentro !== true ? excludeNavPath(navBase, "/incassi") : navBase
  const homePath = firstNavPath(nav)
  const mustRedirectPages =
    customPages && !isPathAllowed(location.pathname, pagesForNav ?? user!.pages!)

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
                : role === "crm"
                  ? "CRM Vendita"
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
      setGroupOpen({ vendite: true, admin: true, piano: true, lp: true })
    }
  }, [])

  // Importante: redirect dopo gli hooks (evita crash React #310 in prod).
  if (mustRedirectBagnini) return <Navigate to="/piscina" replace />
  if (mustRedirectCrm) return <Navigate to="/crm" replace />
  if (mustRedirectPages) return <Navigate to={homePath} replace />

  return (
    <div className="flex min-h-svh flex-col bg-zinc-950 pt-[env(safe-area-inset-top)] text-zinc-100 sm:flex-row">
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
      <PwaInstallHint />

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
