export type AmmOcrHit = {
  fornitore: string
  numeroDocumento: string
  dataDocumento: string
  totale: number | null
  descrizione: string
}

function norm(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim()
}

function parseImporto(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(/€/g, "")
  if (!s) return null
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  let n: number
  if (lastComma > lastDot) n = Number(s.replace(/\./g, "").replace(",", "."))
  else if (lastDot > lastComma) n = Number(s.replace(/,/g, ""))
  else n = Number(s.replace(",", "."))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

function parseDataIt(raw: string): string {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(raw.trim())
  if (!m) return ""
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = Number(m[3])
  if (y < 100) y += 2000
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return ""
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/** Estrae campi fattura da testo OCR/PDF (senza IVA: totale lordo). */
export function parseFatturaText(text: string): AmmOcrHit {
  const raw = String(text ?? "")
  const lines = raw.split(/\r?\n/).map(norm).filter(Boolean)
  const blob = lines.join("\n")

  let dataDocumento = ""
  const dataRe = /(?:data(?:\s+documento|\s+fattura)?|del)\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i
  const dm = dataRe.exec(blob) ?? /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/.exec(blob)
  if (dm) dataDocumento = parseDataIt(dm[1] ?? "")

  let numeroDocumento = ""
  const numRe =
    /(?:n[°o.]?\s*(?:fattura|documento|doc)?|fattura\s*n[°o.]?|numero\s*(?:fattura|documento)?)\s*[:.]?\s*([A-Z0-9][A-Z0-9./-]{1,24})/i
  const nm = numRe.exec(blob)
  if (nm) numeroDocumento = String(nm[1] ?? "").trim()

  let totale: number | null = null
  const totRe =
    /(?:totale\s*(?:documento|fattura|a\s*pagare|complessivo)?|importo\s*(?:totale|lordo)?|grand\s*total)\s*[:.]?\s*€?\s*([\d.]{1,12},\d{2}|[\d,]{1,12}\.\d{2}|\d{1,8}(?:[.,]\d{2})?)/gi
  let tm: RegExpExecArray | null
  while ((tm = totRe.exec(blob))) {
    const v = parseImporto(tm[1] ?? "")
    if (v != null && (totale == null || v > totale)) totale = v
  }

  let fornitore = ""
  const skip = /fattura|documento|partita\s*iva|p\.?\s*iva|codice\s*fiscale|indirizzo|totale|pagina/i
  for (const line of lines.slice(0, 18)) {
    if (line.length < 4 || line.length > 80) continue
    if (skip.test(line)) continue
    if (/^\d/.test(line)) continue
    fornitore = line
    break
  }

  return {
    fornitore,
    numeroDocumento,
    dataDocumento,
    totale,
    descrizione: lines.slice(0, 6).join(" · ").slice(0, 180),
  }
}
