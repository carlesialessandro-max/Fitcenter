export type AmmOcrHit = {
  fornitore: string
  numeroDocumento: string
  dataDocumento: string
  totale: number | null
  descrizione: string
}

const MESI: Record<string, number> = {
  gen: 1,
  gennaio: 1,
  jan: 1,
  january: 1,
  feb: 2,
  febbraio: 2,
  february: 2,
  mar: 3,
  marzo: 3,
  march: 3,
  apr: 4,
  aprile: 4,
  april: 4,
  mag: 5,
  maggio: 5,
  may: 5,
  giu: 6,
  giugno: 6,
  jun: 6,
  june: 6,
  lug: 7,
  luglio: 7,
  jul: 7,
  july: 7,
  ago: 8,
  agosto: 8,
  aug: 8,
  august: 8,
  set: 9,
  sett: 9,
  settembre: 9,
  sep: 9,
  sept: 9,
  september: 9,
  ott: 10,
  ottobre: 10,
  oct: 10,
  october: 10,
  nov: 11,
  novembre: 11,
  november: 11,
  dic: 12,
  dicembre: 12,
  dec: 12,
  december: 12,
}

function norm(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim()
}

export function parseImporto(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(/€/g, "").replace(/eur/gi, "")
  if (!s) return null
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  let n: number
  if (lastComma > lastDot) n = Number(s.replace(/\./g, "").replace(",", "."))
  else if (lastDot > lastComma) n = Number(s.replace(/,/g, ""))
  else n = Number(s.replace(",", "."))
  if (!Number.isFinite(n) || n <= 0 || n > 9_999_999) return null
  return Math.round(n * 100) / 100
}

function isoDate(d: number, mo: number, y: number): string {
  let year = y
  if (year < 100) year += 2000
  if (year < 1990 || year > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return ""
  return `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

export function parseDataIt(raw: string): string {
  const s = norm(raw)
  const num = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s)
  if (num) return isoDate(Number(num[1]), Number(num[2]), Number(num[3]))
  const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s)
  if (iso) return isoDate(Number(iso[3]), Number(iso[2]), Number(iso[1]))
  const named = /^(\d{1,2})\s+([a-zà]{3,12})\.?\s+(\d{2,4})$/i.exec(s)
  if (named) {
    const mo = MESI[named[2].toLowerCase()]
    if (mo) return isoDate(Number(named[1]), mo, Number(named[3]))
  }
  return ""
}

function parseDataFromFilename(name: string): string {
  const n = String(name ?? "")
  const iso = /(\d{4})[ _.-](\d{2})[ _.-](\d{2})/.exec(n)
  if (iso) return isoDate(Number(iso[3]), Number(iso[2]), Number(iso[1]))
  const it = /(\d{2})[ _.-](\d{2})[ _.-](\d{4})/.exec(n)
  if (it) return isoDate(Number(it[1]), Number(it[2]), Number(it[3]))
  return ""
}

const SKIP_FORNITORE =
  /fattura\s+per|id conto|data pagamento|pagamento effettuato|tipo di prodotto|metodo di pagamento|numero di riferimento|id della transazione|hai ricevuto|supplementi|totale|partita\s*iva|p\.?\s*iva|pagina|documento/i

function guessFornitore(lines: string[], blob: string): string {
  if (/\bmeta(\s+inserzioni)?\b/i.test(blob) || /\bfacebook\b/i.test(blob) || /\binstagram\b/i.test(blob)) return "Meta"
  for (const line of lines.slice(0, 24)) {
    if (line.length < 3 || line.length > 80) continue
    if (SKIP_FORNITORE.test(line)) continue
    if (/^\d/.test(line)) continue
    if (/^(visa|mastercard|paypal|bonifico)\b/i.test(line)) continue
    return line
  }
  return ""
}

function guessNumero(blob: string, filename: string): string {
  const ref = /numero\s+di\s+riferimento\s*[:.]?\s*([A-Z0-9][A-Z0-9/-]{3,24})/i.exec(blob)
  if (ref) return ref[1].trim()
  const trx = /(?:id(?:\s+della)?\s+transazione|transazione\s*#)\s*[:.]?\s*([A-Z0-9-]{6,40})/i.exec(blob)
  if (trx) return trx[1].trim()
  const fnTrx = /#\s*([A-Z0-9-]{8,40})/.exec(filename)
  if (fnTrx) return fnTrx[1].trim()
  const fat = /(?:n[°o.]?\s*(?:fattura|documento|doc)|fattura\s*n[°o.]?|numero\s*(?:fattura|documento))\s*[:.]?\s*([A-Z0-9][A-Z0-9./-]{2,24})/i.exec(
    blob
  )
  const n = String(fat?.[1] ?? "").trim()
  if (n && n.length >= 3 && !/^(di|to|del|per|doc|n)$/i.test(n)) return n
  return ""
}

function guessTotale(blob: string): number | null {
  const labeled =
    /(?:pagamento\s+effettuato|totale\s*(?:documento|fattura|a\s*pagare|complessivo)?|importo\s*(?:totale|lordo)?|grand\s*total|addebito)\s*[:.]?\s*€?\s*([\d.]{1,12},\d{2}|[\d,]{1,12}\.\d{2}|\d{1,8}[.,]\d{2})/gi
  let best: number | null = null
  let tm: RegExpExecArray | null
  while ((tm = labeled.exec(blob))) {
    const v = parseImporto(tm[1] ?? "")
    if (v != null && (best == null || v > best)) best = v
  }
  if (best != null) return best
  const euro = /(?:€|eur|euro)\s*([\d.]{1,12},\d{2}|[\d,]{1,12}\.\d{2}|\d{1,8}[.,]\d{2})|([\d.]{1,12},\d{2}|[\d,]{1,12}\.\d{2})\s*(?:€|eur|euro)/gi
  while ((tm = euro.exec(blob))) {
    const v = parseImporto(tm[1] || tm[2] || "")
    if (v != null && (best == null || v > best)) best = v
  }
  return best
}

function guessData(blob: string, filename: string): string {
  const labeled =
    /(?:data\s+pagamento(?:\s*\/\s*fattura)?|data(?:\s+documento|\s+fattura)?|del)\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[a-zà]{3,12}\.?\s+\d{2,4})/gi
  let dm: RegExpExecArray | null
  while ((dm = labeled.exec(blob))) {
    const d = parseDataIt(dm[1] ?? "")
    if (d) return d
  }
  const anyNamed = /(\d{1,2}\s+[a-zà]{3,12}\.?\s+\d{2,4})/i.exec(blob)
  if (anyNamed) {
    const d = parseDataIt(anyNamed[1] ?? "")
    if (d) return d
  }
  const anyNum = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/.exec(blob)
  if (anyNum) {
    const d = parseDataIt(anyNum[1] ?? "")
    if (d) return d
  }
  return parseDataFromFilename(filename)
}

/** Estrae campi fattura da testo OCR/PDF (senza IVA: totale lordo). */
export function parseFatturaText(text: string, filename = ""): AmmOcrHit {
  const raw = String(text ?? "")
  const lines = raw.split(/\r?\n/).map(norm).filter(Boolean)
  const blob = lines.join("\n")
  const fornitore = guessFornitore(lines, blob)
  const numeroDocumento = guessNumero(blob, filename)
  const dataDocumento = guessData(blob, filename)
  const totale = guessTotale(blob)
  let descrizione = lines.slice(0, 8).join(" · ").slice(0, 180)
  if (/\bmeta\s+inserzioni\b/i.test(blob)) descrizione = "Meta inserzioni"
  else if (fornitore === "Meta") descrizione = descrizione || "Meta"
  return { fornitore, numeroDocumento, dataDocumento, totale, descrizione }
}
