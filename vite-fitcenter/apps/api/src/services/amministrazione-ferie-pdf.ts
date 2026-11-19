export type FerieDaFile = {
  nominativo: string
  ferieResidue: number
  ferieGodute?: number
  ferieMaturate?: number
  permessiResidue?: number
}

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

function asDays(n: number): number {
  if (Math.abs(n) > 40) return Math.round((n / 8) * 100) / 100
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

function isPersonName(name: string): boolean {
  const n = name.trim()
  if (n.split(/\s+/).length < 2) return false
  if (!/[a-zàèéìòù]/i.test(n)) return false
  const label = normalizeLabel(n)
  if (/^(totale|totali|cognome|nome|ferie|permessi|matricola|dipendente|riepilogo|periodo)/.test(label)) return false
  return n.length >= 5 && n.length <= 60
}

function nameBeforeFirstAmount(line: string): string {
  const first = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}|\d+(?:[.,]\d{1,2})?/.exec(line)
  const raw = first ? line.slice(0, first.index) : line
  return titleName(raw.replace(/^\s*\d+\s+/, "").replace(/[.;]+$/g, ""))
}

function saldoFromAmounts(amts: number[], headerNorm: string): Omit<FerieDaFile, "nominativo"> | null {
  const nums = amts.filter((n) => Number.isFinite(n)).map(asDays)
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

function parseTabellaFerie(text: string): FerieDaFile[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\t/g, " ").replace(/[ ]+/g, " ").trim()).filter(Boolean)
  const headerAt = lines.findIndex((line) => {
    const label = normalizeLabel(line)
    return label.includes("ferie") && (label.includes("resid") || label.includes("godut") || label.includes("matur"))
  })
  if (headerAt < 0) return []
  const headerNorm = normalizeLabel(lines[headerAt] ?? "")
  const out: FerieDaFile[] = []
  const seen = new Set<string>()
  for (const line of lines.slice(headerAt + 1)) {
    const label = normalizeLabel(line)
    if (label.includes("totale") && !isPersonName(nameBeforeFirstAmount(line))) break
    const nominativo = nameBeforeFirstAmount(line)
    if (!isPersonName(nominativo)) continue
    const amts = amountsOn(line)
    const saldo = saldoFromAmounts(amts, headerNorm)
    if (!saldo) continue
    const key = nominativo.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ nominativo, ...saldo })
  }
  return out
}

function parseCedoliniFerie(text: string): FerieDaFile[] {
  const pages = text.split(/(?=---\s*PAGE\s+\d+\s*---)|(?=\bCEDOLINO\b)|(?=\bNETTO BUSTA\b)/i)
  const out: FerieDaFile[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    const lines = page.split(/\r?\n/).map((l) => l.replace(/\t/g, " ").replace(/[ ]+/g, " ").trim()).filter(Boolean)
    let nominativo = ""
    for (const line of lines.slice(0, 25)) {
      const maybe = titleName(line.replace(/^(dipendente|cognome e nome|nominativo)\s*[:.]?\s*/i, ""))
      if (isPersonName(maybe) && maybe.split(" ").length <= 5) {
        nominativo = maybe
        break
      }
    }
    if (!nominativo) continue
    const blob = lines.join("\n")
    const ferieBlock = /ferie[\s\S]{0,400}?(?:permess|ex fest|rol|netto|retribuz|$)/i.exec(blob)
    const block = ferieBlock?.[0] ?? blob
    const residueM =
      /residu[ae]\s*(?:al\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)?\s*[:=]?\s*((?:\d{1,3}(?:\.\d{3})+|\d+)[.,]\d{2}|\d+[.,]?\d*)/i.exec(
        block,
      )
    const goduteM =
      /godut[ae]\s*(?:nel periodo)?\s*[:=]?\s*((?:\d{1,3}(?:\.\d{3})+|\d+)[.,]\d{2}|\d+[.,]?\d*)/i.exec(block)
    const maturateM =
      /maturat[ae]\s*(?:nel periodo)?\s*[:=]?\s*((?:\d{1,3}(?:\.\d{3})+|\d+)[.,]\d{2}|\d+[.,]?\d*)/i.exec(block)
    if (!residueM && !goduteM) continue
    const ferieResidue = asDays(parseNumeroIta(residueM?.[1] ?? "0") ?? 0)
    const ferieGodute = goduteM ? asDays(parseNumeroIta(goduteM[1] ?? "0") ?? 0) : undefined
    const ferieMaturate = maturateM ? asDays(parseNumeroIta(maturateM[1] ?? "0") ?? 0) : undefined
    const permessiBlock = /permess[\s\S]{0,250}?(?:ex fest|ferie|netto|$)/i.exec(blob)
    const permResM = permessiBlock
      ? /residu[ae]\s*[:=]?\s*((?:\d{1,3}(?:\.\d{3})+|\d+)[.,]\d{2}|\d+[.,]?\d*)/i.exec(permessiBlock[0])
      : null
    const key = nominativo.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      nominativo,
      ferieResidue,
      ferieGodute,
      ferieMaturate,
      permessiResidue: permResM ? asDays(parseNumeroIta(permResM[1] ?? "0") ?? 0) : undefined,
    })
  }
  return out
}

export function parseFeriePdf(text: string): FerieDaFile[] {
  const t = String(text ?? "")
  if (t.trim().length < 20) return []
  const tabella = parseTabellaFerie(t)
  if (tabella.length) return tabella
  return parseCedoliniFerie(t)
}
