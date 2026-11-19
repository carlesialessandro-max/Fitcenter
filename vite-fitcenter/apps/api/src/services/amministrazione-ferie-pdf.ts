export type FerieDaFile = {
  nominativo: string
  ferieResidue: number
  ferieGodute?: number
  ferieMaturate?: number
  permessiResidue?: number
}

const STOP = new Set([
  "page",
  "pagina",
  "altre",
  "trattenute",
  "trattenuta",
  "autorizzazione",
  "numerazione",
  "unitaria",
  "banca",
  "alta",
  "toscana",
  "credito",
  "cooperativa",
  "campi",
  "bisenzio",
  "cartel",
  "unita",
  "produttiva",
  "centro",
  "costo",
  "chiantibanca",
  "crediti",
  "bonus",
  "fiscali",
  "erogazioni",
  "inps",
  "inail",
  "impiegato",
  "indeterminato",
  "importi",
  "retribuzione",
  "paga",
  "scatti",
  "totale",
  "totali",
  "mese",
  "base",
  "conguaglio",
  "aqua",
  "sport",
  "ssd",
  "teamsystem",
  "cedolino",
  "netto",
  "busta",
  "lordo",
  "irpef",
  "tfr",
  "ratei",
  "straordinario",
  "contributi",
  "societa",
  "iban",
  "qualifica",
  "matricola",
  "ferie",
  "permessi",
  "residuo",
  "residue",
  "maturato",
  "maturate",
  "goduto",
  "godute",
  "proiezione",
  "rias",
  "anz",
  "acconto",
  "addizionale",
  "imponibile",
  "ore",
  "lav",
  "ccnl",
  "livello",
  "sede",
  "indirizzo",
  "telefono",
  "fiscale",
  "partita",
  "iva",
  "azienda",
  "periodo",
  "riepilogo",
  "cognome",
  "nome",
  "dipendente",
  "dipendenti",
  "collaboratore",
  "mensile",
  "fissa",
  "tempo",
  "determinato",
  "sc",
  "arl",
  "srl",
  "spa",
])

const PARTICLES = /^(de|del|della|dello|dei|degli|di|da|van|von|la|lo|le|mc|mac|san|santa)$/i

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

function titleName(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|\s)([a-zàèéìòù])/g, (_, a, b) => a + String(b).toUpperCase())
}

function parseNumeroIta(raw: string): number | null {
  const s = String(raw ?? "")
    .replace(/\s/g, "")
    .replace(/€/g, "")
  if (!s || s === "-") return 0
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  let n: number
  if (lastComma > lastDot) n = Number(s.replace(/\./g, "").replace(",", "."))
  else if (lastDot > lastComma) n = Number(s.replace(/,/g, ""))
  else n = Number(s.replace(",", "."))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

function hoursToDays(n: number): number {
  return Math.round((n / 8) * 100) / 100
}

function asDays(n: number, hours: boolean): number {
  if (hours) return hoursToDays(n)
  if (Math.abs(n) > 50) return hoursToDays(n)
  return n
}

function amountsOn(line: string): number[] {
  const out: number[] = []
  const re = /(?:€\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}|\d+(?:[.,]\d{1,2})?|-)\s*(?:€|h|gg|g)?(?![\d.,])/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const n = parseNumeroIta(m[1] ?? "")
    if (n != null) out.push(n)
  }
  return out
}

export function isNominativoPersona(name: string): boolean {
  const n = name.trim().replace(/\s+/g, " ")
  if (n.length < 5 || n.length > 70) return false
  if (/---|\bpage\b|\bpagina\b/i.test(n)) return false
  if (/\d{2,}/.test(n)) return false
  if (/[€$]|\/|\(|\)|,/.test(n)) return false
  if (/^(mc|pg|wt|tr|ct)\d/i.test(n.replace(/\s/g, ""))) return false
  const words = n.split(" ").filter(Boolean)
  if (words.length < 2 || words.length > 5) return false
  const norms = words.map((w) => normalizeLabel(w))
  if (norms.some((w) => STOP.has(w))) return false
  const nameWords = words.filter((w) => {
    const clean = w.replace(/\.$/, "")
    if (PARTICLES.test(clean)) return false
    return /^[a-zàèéìòù']{2,}$/i.test(clean) || /^[a-zàèéìòù]$/i.test(clean)
  })
  if (nameWords.length < 2) return false
  const long = nameWords.filter((w) => w.replace(/\.$/, "").length >= 3)
  return long.length >= 2
}

function nameBeforeFirstAmount(line: string): string {
  const first = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}|\d+(?:[.,]\d{1,2})?/.exec(line)
  const raw = first ? line.slice(0, first.index) : line
  return titleName(raw.replace(/^\s*\d+\s+/, "").replace(/[.;]+$/g, ""))
}

function saldoFromAmounts(amts: number[], headerNorm: string, hours: boolean): Omit<FerieDaFile, "nominativo"> | null {
  const nums = amts.filter((n) => Number.isFinite(n)).map((n) => asDays(n, hours))
  if (!nums.length) return null
  if (nums.length === 1) return { ferieResidue: nums[0]! }
  if (nums.length === 3) {
    const residPos = headerNorm.indexOf("resid")
    const godPos = headerNorm.indexOf("god")
    const matPos = headerNorm.indexOf("matur")
    const firstIsResidue = residPos >= 0 && (godPos < 0 || residPos <= godPos) && (matPos < 0 || residPos <= matPos)
    if (firstIsResidue) {
      return { ferieResidue: nums[0]!, ferieGodute: nums[1], ferieMaturate: nums[2] }
    }
    return { ferieMaturate: nums[0], ferieGodute: nums[1], ferieResidue: nums[2]! }
  }
  if (nums.length < 4) return { ferieResidue: nums[nums.length - 1]! }
  const ferieResidue = nums[3]!
  const ferieGodute = nums[2]
  const ferieMaturate = nums[1]
  const permessiResidue = nums.length >= 8 ? nums[7] : undefined
  return {
    ferieResidue,
    ferieGodute,
    ferieMaturate,
    permessiResidue,
  }
}

function isCedolinoFerieHeader(line: string): boolean {
  const label = normalizeLabel(line)
  const hasFerieBox = label.includes("annoprec") || label.includes("proiezion")
  return hasFerieBox && (label.includes("resid") || label.includes("matur") || label.includes("godut"))
}

function parseTabellaFerie(text: string): FerieDaFile[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\t/g, " ").replace(/[ ]+/g, " ").trim()).filter(Boolean)
  const headerAt = lines.findIndex((line) => {
    const label = normalizeLabel(line)
    if (isCedolinoFerieHeader(line)) return false
    const hasPeople = label.includes("cognome") || label.includes("nominativo") || label.includes("dipendente") || label.includes("matricola")
    return hasPeople && label.includes("ferie") && (label.includes("resid") || label.includes("godut") || label.includes("matur"))
  })
  if (headerAt < 0) return []
  const headerNorm = normalizeLabel(lines[headerAt] ?? "")
  const hours = /\bh\b|\bore\b/i.test(lines[headerAt] ?? "")
  const out: FerieDaFile[] = []
  const seen = new Set<string>()
  for (const line of lines.slice(headerAt + 1)) {
    const label = normalizeLabel(line)
    if (label.includes("totale") && !isNominativoPersona(nameBeforeFirstAmount(line))) break
    const nominativo = nameBeforeFirstAmount(line)
    if (!isNominativoPersona(nominativo)) continue
    const amts = amountsOn(line)
    const saldo = saldoFromAmounts(amts, headerNorm, hours)
    if (!saldo) continue
    const key = nominativo.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ nominativo, ...saldo })
  }
  return out
}

function splitCedolini(text: string): string[] {
  const parts = text.split(/(?=---\s*PAGE\s+\d+\s*---)|(?=\bCEDOLINO\b)|(?=\bNETTO BUSTA\b)|(?=\bCOGNOME E NOME\b)/i)
  return parts.map((p) => p.trim()).filter((p) => p.length > 40)
}

function findCedolinoNominativo(lines: string[]): string {
  const head = lines.slice(0, 55)
  for (const line of head) {
    const labeled =
      /(?:cognome\s*e\s*nome|cognome\s*nome|nominativo|dipendente)\s*[:.]?\s*(.+)$/i.exec(line) ??
      /matr(?:icola)?\.?\s*\d+\s+(.+)$/i.exec(line)
    if (!labeled) continue
    const n = titleName(
      labeled[1]!
        .replace(/\b(qualifica|livello|ccnl|mansione|data|nato|codice|cf|c\.f\.).*$/i, "")
        .replace(/\s+\d[\d.,]*$/g, "")
        .trim(),
    )
    if (isNominativoPersona(n)) return n
  }
  for (const line of head) {
    const m = /^([A-ZÀÈÉÌÒÙ']{2,}(?:\s+[A-ZÀÈÉÌÒÙ']{1,}){1,4})\s*$/.exec(line)
    if (!m) continue
    const n = titleName(m[1]!)
    if (isNominativoPersona(n)) return n
  }
  return ""
}

function saldoFromFerieRow(lines: string[], idx: number, kind: "ferie" | "permessi"): Omit<FerieDaFile, "nominativo"> | null {
  if (idx < 0) return null
  const blob = lines.slice(idx, idx + 3).join(" ")
  const hours = /\bh\b|\bore\b/i.test(blob)
  const amts = amountsOn(blob).filter((n) => Number.isFinite(n))
  if (!amts.length) return null
  const residIdx = amts.length >= 4 ? 3 : amts.length - 1
  const residuo = asDays(amts[residIdx]!, hours)
  const maturato = amts.length >= 2 ? asDays(amts[1]!, hours) : undefined
  const goduto = amts.length >= 3 ? asDays(amts[2]!, hours) : undefined
  if (kind === "permessi") return { ferieResidue: 0, permessiResidue: residuo }
  return {
    ferieResidue: residuo,
    ferieGodute: goduto,
    ferieMaturate: maturato,
  }
}

function parseCedoliniFerie(text: string): FerieDaFile[] {
  const pages = splitCedolini(text)
  const out: FerieDaFile[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    const lines = page.split(/\r?\n/).map((l) => l.replace(/\t/g, " ").replace(/[ ]+/g, " ").trim()).filter(Boolean)
    const nominativo = findCedolinoNominativo(lines)
    if (!nominativo) continue
    const ferieIdx = lines.findIndex((line) => /^ferie\b/i.test(line.trim()) && !isCedolinoFerieHeader(line))
    const ferie = saldoFromFerieRow(lines, ferieIdx, "ferie")
    if (!ferie) continue
    const permessiIdx = lines.findIndex((line) => /^permess/i.test(line.trim()))
    const permessi = saldoFromFerieRow(lines, permessiIdx, "permessi")
    const key = nominativo.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      nominativo,
      ferieResidue: ferie.ferieResidue,
      ferieGodute: ferie.ferieGodute,
      ferieMaturate: ferie.ferieMaturate,
      permessiResidue: permessi?.permessiResidue,
    })
  }
  return out
}

export function parseFeriePdf(text: string): FerieDaFile[] {
  const t = String(text ?? "")
  if (t.trim().length < 20) return []
  const cedolini = parseCedoliniFerie(t)
  if (cedolini.length) return cedolini
  return parseTabellaFerie(t)
}
