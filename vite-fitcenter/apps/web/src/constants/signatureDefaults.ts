import type { SignatureField, SignatureSlot } from "@/types/signature"

/** Allineato all’API (`defaultSignatureSlots`): usato se il template non ha ancora `slots` nel JSON. */
export const DEFAULT_SIGNATURE_SLOTS: SignatureSlot[] = [
  { id: "tesseramento", label: "Tesseramento", page: 1, x: 50, y: 90, width: 240, height: 80, order: 1 },
  { id: "contratto", label: "Contratto", page: 1, x: 330, y: 90, width: 240, height: 80, order: 2 },
  { id: "privacy-1", label: "Privacy 1", page: 1, x: 50, y: 190, width: 240, height: 80, order: 3 },
  { id: "privacy-2", label: "Privacy 2", page: 1, x: 330, y: 190, width: 240, height: 80, order: 4 },
  { id: "privacy-3", label: "Privacy 3", page: 1, x: 50, y: 290, width: 240, height: 80, order: 5 },
]

export const DEFAULT_SIGNATURE_FIELDS: SignatureField[] = [
  { id: "nome", label: "Nome", page: 1, x: 120, y: 715, order: 1, size: 10, maxWidth: 200 },
  { id: "cognome", label: "Cognome", page: 1, x: 120, y: 690, order: 2, size: 10, maxWidth: 200 },
  { id: "cellulare", label: "Cellulare", page: 1, x: 390, y: 715, order: 3, size: 10, maxWidth: 160 },
  { id: "email", label: "Email", page: 1, x: 390, y: 690, order: 4, size: 9, maxWidth: 220 },
  { id: "indirizzo", label: "Indirizzo", page: 1, x: 120, y: 665, order: 5, size: 9, maxWidth: 320 },
  { id: "cap", label: "CAP", page: 1, x: 120, y: 642, order: 6, size: 9, maxWidth: 70 },
  { id: "citta", label: "Città", page: 1, x: 200, y: 642, order: 7, size: 9, maxWidth: 180 },
  { id: "provincia", label: "Provincia", page: 1, x: 390, y: 642, order: 8, size: 9, maxWidth: 60 },
  { id: "data_nascita", label: "Data nascita", page: 1, x: 120, y: 620, order: 9, size: 9, maxWidth: 120 },
  { id: "luogo_nascita", label: "Luogo nascita", page: 1, x: 260, y: 620, order: 10, size: 9, maxWidth: 200 },
  { id: "codice_fiscale", label: "Codice fiscale", page: 1, x: 390, y: 620, order: 10, size: 9, maxWidth: 220 },
  { id: "legale_rappresentante", label: "Legale rappresentante (minori)", page: 1, x: 280, y: 690, order: 11, size: 9, maxWidth: 280 },
  { id: "asi_tessera", label: "ASI Tessera N.", page: 1, x: 140, y: 285, order: 12, size: 9, maxWidth: 220 },
  { id: "data_oggi", label: "Data (oggi)", page: 1, x: 470, y: 305, order: 13, size: 9, maxWidth: 90 },
  { id: "movimenti", label: "Movimenti (lista)", page: 1, x: 120, y: 520, order: 14, size: 8, maxWidth: 420, multiline: true, lineHeight: 11, maxLines: 10 },
  { id: "totale_generale", label: "Totale generale", page: 1, x: 440, y: 555, order: 15, size: 10, maxWidth: 120 },
]
