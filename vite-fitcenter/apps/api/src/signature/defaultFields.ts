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
    { id: "cap_citta", label: "CAP + Città", page: 1, x: 120, y: 642, order: 6, size: 9, maxWidth: 260 },
    { id: "provincia", label: "Provincia", page: 1, x: 390, y: 642, order: 7, size: 9, maxWidth: 60 },
    { id: "data_nascita", label: "Data nascita", page: 1, x: 120, y: 620, order: 8, size: 9, maxWidth: 120 },
    { id: "luogo_nascita", label: "Luogo nascita", page: 1, x: 260, y: 620, order: 9, size: 9, maxWidth: 200 },
    { id: "servizi", label: "Servizi / Importo", page: 1, x: 120, y: 485, order: 10, size: 9, maxWidth: 420 },
  ]
}

export function ensureSignatureFields(fields: SignatureField[] | undefined | null): SignatureField[] {
  const defaults = defaultSignatureFields()
  if (!Array.isArray(fields) || fields.length === 0) return defaults.map((f) => ({ ...f }))

  // Template salvato: usa l’elenco così com’è, ma completa proprietà mancanti con fallback dai default.
  const byId = new Map(defaults.map((d) => [d.id, d]))
  return fields
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
      }
    })
}

