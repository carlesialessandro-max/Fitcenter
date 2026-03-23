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
  if (!Array.isArray(slots) || slots.length === 0) {
    return defaults.map((s) => ({ ...s }))
  }

  // Compatibilita template vecchi: se hanno meno di 5 slot, aggiungiamo quelli mancanti.
  const byId = new Map(slots.map((s) => [s.id, s]))
  return defaults.map((d) => ({ ...(byId.get(d.id) ?? d) }))
}
