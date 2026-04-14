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
  { id: "cap_citta", label: "CAP + Città", page: 1, x: 120, y: 642, order: 6, size: 9, maxWidth: 260 },
  { id: "provincia", label: "Provincia", page: 1, x: 390, y: 642, order: 7, size: 9, maxWidth: 60 },
  { id: "data_nascita", label: "Data nascita", page: 1, x: 120, y: 620, order: 8, size: 9, maxWidth: 120 },
  { id: "luogo_nascita", label: "Luogo nascita", page: 1, x: 260, y: 620, order: 9, size: 9, maxWidth: 200 },
  { id: "codice_fiscale", label: "Codice fiscale", page: 1, x: 390, y: 620, order: 10, size: 9, maxWidth: 220 },
  { id: "servizi", label: "Servizi / Importo", page: 1, x: 120, y: 485, order: 11, size: 9, maxWidth: 420 },
]
