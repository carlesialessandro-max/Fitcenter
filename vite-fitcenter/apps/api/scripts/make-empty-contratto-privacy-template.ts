import fs from "fs"
import path from "path"
import { PDFDocument, rgb } from "pdf-lib"

/**
 * Genera un template “vuoto” coprendo i valori cliente sulla pagina 1.
 *
 * Uso:
 *   pnpm -C apps/api exec tsx scripts/make-empty-contratto-privacy-template.ts "C:/path/in.pdf" "C:/path/out.pdf"
 *
 * NOTE:
 * - È una “redazione” best-effort: copre le aree dove di solito ci sono i dati (Nome/Cognome/CF/Telefono/Email/Indirizzo e righe servizi).
 * - Dopo averlo creato, caricalo in pagina Firme come nuovo template e poi regola i campi con l’editor.
 */

async function main() {
  const inPath = process.argv[2]
  const outPath = process.argv[3]
  if (!inPath || !outPath) {
    throw new Error('Argomenti mancanti. Esempio: tsx script.ts "C:/in.pdf" "C:/out.pdf"')
  }
  const bytes = fs.readFileSync(inPath)
  const pdf = await PDFDocument.load(bytes)
  const pages = pdf.getPages()
  if (!pages.length) throw new Error("PDF senza pagine")

  const p1 = pages[0]
  const white = rgb(1, 1, 1)

  // Coordinate pdf-lib: origine in basso a sinistra.
  // Questi rettangoli coprono SOLO le zone “valore” (non le etichette).
  // (Da rifinire se necessario: è pensato per MOD019.)
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [
    // Anagrafica sinistra: copriamo la colonna valori, lasciando le etichette (Nome/Cognome/...)
    { x: 115, y: 705, w: 165, h: 12 }, // Nome valore
    { x: 115, y: 688, w: 165, h: 12 }, // Cognome valore
    { x: 115, y: 671, w: 165, h: 12 }, // Nato/a valore
    { x: 115, y: 654, w: 250, h: 12 }, // Indirizzo valore
    { x: 115, y: 637, w: 120, h: 12 }, // CAP valore
    { x: 115, y: 620, w: 165, h: 12 }, // Città valore
    { x: 115, y: 603, w: 165, h: 12 }, // Telefono valore
    { x: 115, y: 586, w: 165, h: 12 }, // Ufficio valore
    { x: 115, y: 569, w: 250, h: 12 }, // Spett.le/condizioni valore (eventuale)

    // Colonna destra: valori (Cellulare/Email/CF/legale rappresentante ecc.)
    { x: 385, y: 705, w: 170, h: 12 }, // Cellulare valore
    { x: 385, y: 688, w: 170, h: 12 }, // Email valore
    { x: 385, y: 671, w: 170, h: 12 }, // Cod.Fisc/PIVA valore
    { x: 385, y: 654, w: 170, h: 12 }, // "il" / data valore
    { x: 385, y: 637, w: 170, h: 12 }, // Per i minorenni: nome legale rappresentante valore

    // Tabella riepilogo servizi: copriamo SOLO le righe (non l'intestazione)
    { x: 60, y: 505, w: 495, h: 70 },

    // Totale generale (numero) riga sotto tabella
    { x: 420, y: 548, w: 135, h: 14 },

    // ASI tessera (numero) nel riquadro sinistro in basso
    { x: 135, y: 256, w: 240, h: 14 },

    // Data nel riquadro lettera a destra (sopra) e nome destinatario
    { x: 475, y: 303, w: 80, h: 14 }, // Data
    { x: 395, y: 270, w: 160, h: 18 }, // Nome destinatario
  ]

  for (const r of rects) {
    p1.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: white, borderColor: white })
  }

  const outBytes = await pdf.save()
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, outBytes)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

