import type { SignatureSlot } from "@/types/signature"

/** Allineato all’API (`defaultSignatureSlots`): usato se il template non ha ancora `slots` nel JSON. */
export const DEFAULT_SIGNATURE_SLOTS: SignatureSlot[] = [
  { id: "tesseramento", label: "Tesseramento", page: 1, x: 50, y: 90, width: 240, height: 80, order: 1 },
  { id: "contratto", label: "Contratto", page: 1, x: 330, y: 90, width: 240, height: 80, order: 2 },
  { id: "privacy-1", label: "Privacy 1", page: 1, x: 50, y: 190, width: 240, height: 80, order: 3 },
  { id: "privacy-2", label: "Privacy 2", page: 1, x: 330, y: 190, width: 240, height: 80, order: 4 },
  { id: "privacy-3", label: "Privacy 3", page: 1, x: 50, y: 290, width: 240, height: 80, order: 5 },
]
