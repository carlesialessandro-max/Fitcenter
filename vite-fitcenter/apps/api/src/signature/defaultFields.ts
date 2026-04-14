import type { SignatureField } from "../types/esign.js"

/**
 * Campi precompilabili nel PDF.
 * Le coordinate dipendono dal template: qui mettiamo un set “base” e l’admin può regolarle.
 */
export function defaultSignatureFields(): SignatureField[] {
  return [
    { id: "nome", label: "Nome", page: 1, x: 120, y: 715, order: 1, size: 10, maxWidth: 200 },
    { id: "cognome", label: "Cognome", page: 1, x: 120, y: 690, order: 2, size: 10, maxWidth: 200 },
    { id: "cellulare", label: "Cellulare", page: 1, x: 390, y: 715, order: 3, size: 10, maxWidth: 160 },
    { id: "email", label: "Email", page: 1, x: 390, y: 690, order: 4, size: 9, maxWidth: 220 },
    { id: "indirizzo", label: "Indirizzo", page: 1, x: 120, y: 665, order: 5, size: 9, maxWidth: 320 },
    { id: "cap", label: "CAP", page: 1, x: 120, y: 642, order: 6, size: 9, maxWidth: 70 },
    { id: "citta", label: "Città", page: 1, x: 200, y: 642, order: 7, size: 9, maxWidth: 180 },
    { id: "provincia", label: "Provincia", page: 1, x: 390, y: 642, order: 7, size: 9, maxWidth: 60 },
    { id: "data_nascita", label: "Data nascita", page: 1, x: 120, y: 620, order: 8, size: 9, maxWidth: 120 },
    { id: "luogo_nascita", label: "Luogo nascita", page: 1, x: 260, y: 620, order: 9, size: 9, maxWidth: 200 },
    { id: "codice_fiscale", label: "Codice fiscale", page: 1, x: 390, y: 620, order: 10, size: 9, maxWidth: 220 },
    { id: "legale_rappresentante", label: "Legale rappresentante (minori)", page: 1, x: 280, y: 690, order: 11, size: 9, maxWidth: 280 },
    { id: "asi_tessera", label: "ASI Tessera N.", page: 1, x: 140, y: 285, order: 12, size: 9, maxWidth: 220 },
    { id: "data_oggi", label: "Data (oggi)", page: 1, x: 470, y: 305, order: 13, size: 9, maxWidth: 90 },
    // Lista movimenti: multilinea (una riga per movimento)
    { id: "movimenti", label: "Movimenti (lista)", page: 1, x: 120, y: 520, order: 14, size: 8, maxWidth: 420, multiline: true, lineHeight: 11, maxLines: 10 },
    { id: "totale_generale", label: "Totale generale (Totale)", page: 1, x: 440, y: 555, order: 15, size: 10, maxWidth: 80 },
    { id: "versato_generale", label: "Totale generale (Versato)", page: 1, x: 515, y: 555, order: 16, size: 10, maxWidth: 80 },
  ]
}

export function ensureSignatureFields(fields: SignatureField[] | undefined | null): SignatureField[] {
  const defaults = defaultSignatureFields()
  if (!Array.isArray(fields) || fields.length === 0) return defaults.map((f) => ({ ...f }))

  // Compatibilità: alcuni template vecchi usano cap_citta + campi nascita. Qui migriamo senza rompere la precompilazione.
  const cleaned = fields
    .flatMap((f) => {
      const id = String(f.id)
      if (id !== "cap_citta") return [f]
      // Sostituisce cap_citta con 2 campi: cap + citta.
      const capBase = defaults.find((d) => d.id === "cap")
      const cittaBase = defaults.find((d) => d.id === "citta")
      const order = Number(f.order ?? 0) || 1
      const page = Number(f.page ?? capBase?.page ?? 1)
      const y = Number(f.y ?? capBase?.y ?? 642)
      const x = Number(f.x ?? capBase?.x ?? 120)
      const size = Number(f.size ?? capBase?.size ?? 9)
      return [
        {
          id: "cap",
          label: capBase?.label ?? "CAP",
          page,
          x,
          y,
          order,
          size,
          maxWidth: capBase?.maxWidth ?? 70,
        },
        {
          id: "citta",
          label: cittaBase?.label ?? "Città",
          page,
          x: x + 80,
          y,
          order: order + 1,
          size,
          maxWidth: cittaBase?.maxWidth ?? 180,
        },
      ]
    })

  // Se il template salvato non contiene alcuni campi standard (es. asi_tessera), li aggiungiamo dai default.
  const ids = new Set(cleaned.map((f) => String(f.id)))
  const maxOrder = cleaned.reduce((m, f) => Math.max(m, Number(f.order ?? 0) || 0), 0) || 0
  const withMissing = cleaned.slice()
  let nextOrder = maxOrder + 1
  for (const d of defaults) {
    if (ids.has(d.id)) continue
    withMissing.push({ ...d, order: nextOrder++ })
  }

  // Dedup: alcuni template possono contenere id duplicati (che portano a doppio rendering).
  const seen = new Set<string>()
  const unique = withMissing.filter((f) => {
    const id = String(f.id ?? "").trim()
    if (!id) return false
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  // Template salvato: usa l’elenco così com’è (più eventuali missing), ma completa proprietà mancanti con fallback dai default.
  const byId = new Map(defaults.map((d) => [d.id, d]))
  return unique
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((f, i) => {
      const base = byId.get(String(f.id))
      return {
        id: String(f.id || `field-${i + 1}`),
        label: String(f.label ?? base?.label ?? `Campo ${i + 1}`),
        page: Math.max(1, Number(f.page ?? base?.page ?? 1)),
        x: Number(f.x ?? base?.x ?? 50),
        y: Number(f.y ?? base?.y ?? 50),
        order: Math.max(1, Number(f.order ?? base?.order ?? i + 1)),
        size: Number(f.size ?? base?.size ?? 10),
        maxWidth: f.maxWidth != null ? Number(f.maxWidth) : base?.maxWidth,
        multiline: Boolean(f.multiline ?? base?.multiline),
        lineHeight: f.lineHeight != null ? Number(f.lineHeight) : base?.lineHeight,
        maxLines: f.maxLines != null ? Number(f.maxLines) : base?.maxLines,
      }
    })
}

