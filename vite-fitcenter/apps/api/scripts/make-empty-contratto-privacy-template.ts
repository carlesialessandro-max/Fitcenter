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
  // Questi rettangoli coprono le zone “valore” della scheda anagrafica.
  // (Da rifinire se necessario: è pensato per il tuo MOD019 in screenshot.)
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [
    // Blocco dati in alto (nome/cognome/nato/indirizzo/contatti/cf)
    { x: 55, y: 660, w: 500, h: 105 },
    // Area riepilogo servizi (righe tabella)
    { x: 55, y: 520, w: 500, h: 110 },
    // Totale generale (numero)
    { x: 400, y: 610, w: 155, h: 20 },
    // ASI tessera (numero)
    { x: 110, y: 250, w: 260, h: 18 },
    // Data lettera (in alto a destra del riquadro lettera)
    { x: 430, y: 285, w: 125, h: 18 },
    // Nome nel riquadro lettera (destinatario)
    { x: 395, y: 265, w: 160, h: 22 },
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

