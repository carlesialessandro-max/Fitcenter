import type { Role } from "../types/auth.js"

export type PageDef = { path: string; label: string; group: string }

/** Pagine selezionabili in gestione utenti (menu). */
export const PAGE_CATALOG: PageDef[] = [
  { path: "/", label: "Dashboard", group: "Vendite" },
  { path: "/stampa-report", label: "Stampa report", group: "Vendite" },
  { path: "/referral", label: "Referral", group: "Vendite" },
  { path: "/convalide-consulenti", label: "Convalide", group: "Vendite" },
  { path: "/attivi-analisi", label: "Attivi", group: "Vendite" },
  { path: "/crm", label: "CRM vendita", group: "Vendite" },
  { path: "/crm/whatsapp-log", label: "Log WhatsApp", group: "Vendite" },
  { path: "/telefonate", label: "Telefonate", group: "Vendite" },
  { path: "/abbonamenti", label: "Abbonamenti in scadenza", group: "Vendite" },
  { path: "/andamento-vendite", label: "Andamento vendite", group: "Vendite" },
  { path: "/andamento-vendite-bambini", label: "Andamento vendite bambini", group: "Vendite" },
  { path: "/vendite-cross", label: "Cross", group: "Vendite" },
  { path: "/lezioni-private/richieste", label: "Richieste lezioni private", group: "Lezioni private" },
  { path: "/lezioni-private/calendario", label: "Calendario vasche", group: "Lezioni private" },
  { path: "/lezioni-private/istruttori", label: "Istruttori / regole", group: "Lezioni private" },
  { path: "/calendario", label: "Piano operativo", group: "Piano operativo" },
  { path: "/calendario/corsi", label: "Calendario corsi", group: "Piano operativo" },
  { path: "/calendario/personale", label: "Personale", group: "Piano operativo" },
  { path: "/calendario/campus", label: "Calendario campus", group: "Piano operativo" },
  { path: "/calendario/scuola-nuoto", label: "Calendario scuola nuoto", group: "Piano operativo" },
  { path: "/calendario/acquaticita", label: "Calendario acquaticità", group: "Piano operativo" },
  { path: "/calendario/spogliatoi", label: "Calendario spogliatoi", group: "Piano operativo" },
  { path: "/calendario/piscina", label: "Calendario bagnini", group: "Piano operativo" },
  { path: "/calendario/reception", label: "Calendario reception", group: "Piano operativo" },
  { path: "/calendario/sala-fitness", label: "Calendario sala fitness", group: "Piano operativo" },
  { path: "/corsi", label: "Corsi", group: "Corsi e piscina" },
  { path: "/corsi/presenze", label: "Presenze corsi", group: "Corsi e piscina" },
  { path: "/corsi/nuoto-libero", label: "Nuoto libero", group: "Corsi e piscina" },
  { path: "/corsi/assenze", label: "Assenze (mese)", group: "Corsi e piscina" },
  { path: "/incassi", label: "Incassi", group: "Altri" },
  { path: "/firme", label: "Firme", group: "Altri" },
  { path: "/firma-cassa", label: "Firma cassa", group: "Altri" },
  { path: "/scontrini", label: "Scontrini", group: "Altri" },
  { path: "/piscina", label: "Mappa piscina", group: "Altri" },
  { path: "/scuola-nuoto", label: "Scuola nuoto", group: "Altri" },
  { path: "/scuola-nuoto/note", label: "Archivio note scuola nuoto", group: "Altri" },
  { path: "/campus", label: "Campus", group: "Altri" },
  { path: "/danza", label: "Danza", group: "Altri" },
  { path: "/utenti", label: "Utenti e accessi", group: "Altri" },
]

const CATALOG_PATHS = new Set(PAGE_CATALOG.map((p) => p.path))

export const ALL_PAGE_PATHS: string[] = PAGE_CATALOG.map((p) => p.path)

const LP = [
  "/lezioni-private/richieste",
  "/lezioni-private/calendario",
  "/lezioni-private/istruttori",
] as const

/** Pagine di default per ruolo (come il menu attuale). */
export const ROLE_DEFAULT_PAGES: Record<Role, string[]> = {
  admin: [...ALL_PAGE_PATHS],
  operatore: [
    "/",
    "/referral",
    "/firme",
    "/firma-cassa",
    "/scontrini",
    "/incassi",
    "/calendario/reception",
    "/crm",
    "/crm/whatsapp-log",
    "/telefonate",
    "/stampa-report",
    "/abbonamenti",
    "/andamento-vendite",
    "/andamento-vendite-bambini",
    "/vendite-cross",
    "/piscina",
    ...LP,
  ],
  corsi: [
    "/calendario/corsi",
    "/calendario/personale",
    "/corsi",
    "/corsi/presenze",
    "/corsi/nuoto-libero",
    "/corsi/assenze",
  ],
  istruttore: ["/calendario/corsi", "/calendario/personale", "/corsi", "/corsi/presenze", ...LP],
  campus: ["/calendario/campus", "/calendario/personale", "/campus"],
  firme: ["/firma-cassa", "/scontrini", "/campus", "/calendario/reception", "/piscina", ...LP],
  scuola_nuoto: [
    "/calendario/scuola-nuoto",
    "/calendario/personale",
    "/scuola-nuoto",
    "/scuola-nuoto/note",
    "/andamento-vendite-bambini",
    ...LP,
  ],
  bagnini: ["/calendario/piscina", "/calendario/personale", "/piscina", "/corsi/nuoto-libero"],
  danza: ["/calendario/personale", "/danza"],
  crm: ["/crm", "/crm/whatsapp-log"],
}

export function sanitizePages(pages: unknown, role: Role): string[] | undefined {
  if (!Array.isArray(pages)) return undefined
  const allowed = new Set(ROLE_DEFAULT_PAGES[role] ?? [])
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of pages) {
    const p = String(raw ?? "").trim()
    if (!p || !CATALOG_PATHS.has(p) || !allowed.has(p) || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  const defaults = ROLE_DEFAULT_PAGES[role] ?? []
  if (!out.length || (out.length === defaults.length && defaults.every((d) => seen.has(d)))) {
    return undefined
  }
  return out
}

export function pagesForUser(role: Role, pages?: string[]): string[] {
  if (pages?.length) return pages
  if (role === "admin") return [...ALL_PAGE_PATHS]
  return [...(ROLE_DEFAULT_PAGES[role] ?? [])]
}
