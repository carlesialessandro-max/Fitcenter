import type { SignatureSlot } from "../types/esign.js"

/** Slot predefiniti: 5 firme in sequenza (privacy multi-firma). */
export function defaultSignatureSlots(): SignatureSlot[] {
  return [
    { id: "tesseramento", label: "Tesseramento", page: 1, x: 50, y: 90, width: 240, height: 80, order: 1 },
    { id: "contratto", label: "Contratto", page: 1, x: 330, y: 90, width: 240, height: 80, order: 2 },
    { id: "privacy-1", label: "Privacy 1", page: 1, x: 50, y: 190, width: 240, height: 80, order: 3 },
    { id: "privacy-2", label: "Privacy 2", page: 1, x: 330, y: 190, width: 240, height: 80, order: 4 },
    { id: "privacy-3", label: "Privacy 3", page: 1, x: 50, y: 290, width: 240, height: 80, order: 5 },
  ]
}

export function ensureSignatureSlots(slots: SignatureSlot[] | undefined | null): SignatureSlot[] {
  const defaults = defaultSignatureSlots()
  const defaultById = new Map(defaults.map((s) => [s.id, s]))
  if (!Array.isArray(slots) || slots.length === 0) {
    return defaults.map((s) => ({ ...s }))
  }

  // Template salvato: usiamo l’elenco così com’è (anche 1 sola firma). Prima si faceva merge su 5
  // default e risultavano sempre 5 step anche se sul PDF serviva una firma sola.
  return slots
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s, i) => {
      const base = defaultById.get(String(s.id))
      const id = String(s.id || `slot-${i + 1}`)
      return {
        id,
        label: String(s.label ?? base?.label ?? `Firma ${i + 1}`),
        page: Math.max(1, Number(s.page ?? base?.page ?? 1)),
        x: Number(s.x ?? base?.x ?? 50),
        y: Number(s.y ?? base?.y ?? 50),
        width: Math.max(40, Number(s.width ?? base?.width ?? 220)),
        height: Math.max(20, Number(s.height ?? base?.height ?? 80)),
        order: Math.max(1, Number(s.order ?? base?.order ?? i + 1)),
      }
    })
}
