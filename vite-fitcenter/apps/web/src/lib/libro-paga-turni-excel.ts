import * as XLSX from "xlsx"
import type { LpagaPersonale, LpagaTurnoRow, LpagaLivello } from "@/api/libroPaga"

export type ImportTurnoExcelPreview = {
  riga: number
  giorno: string
  personale: string
  personaleId?: string
  mansione: string
  livelloId?: string
  quantita: number
  note: string
  errore?: string
  duplicato?: boolean
}

function normalized(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("it")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function parseDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = XLSX.SSF.parse_date_code(value)
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`
  }
  const text = String(value ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const it = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (it) return `${it[3]}-${it[2].padStart(2, "0")}-${it[1].padStart(2, "0")}`
  return ""
}

function parseQuantity(value: unknown): number {
  if (typeof value === "number") return value
  const text = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".")
  return text ? Number(text) : Number.NaN
}

function resolveByName<T>(name: string, rows: T[], label: (row: T) => string): T | null {
  const key = normalized(name)
  if (!key) return null
  const matches = rows.filter((row) => normalized(label(row)) === key)
  return matches.length === 1 ? matches[0]! : null
}

function duplicateKey(row: Pick<ImportTurnoExcelPreview, "giorno" | "personaleId" | "livelloId" | "quantita" | "note">) {
  return [
    row.giorno,
    row.personaleId,
    row.livelloId,
    row.quantita.toFixed(2),
    row.note
      .trim()
      .toLocaleLowerCase("it")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  ].join("|")
}

export function downloadLibroPagaTurniTemplate() {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([["Data", "Collaboratore", "Mansione", "Quantità", "Note"]])
  sheet["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 32 }, { wch: 14 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(workbook, sheet, "Turni")
  const example = XLSX.utils.aoa_to_sheet([
    ["gg/mm/aaaa", "Nome Cognome come in anagrafica", "Nome mansione come in libro paga", "ore o servizi (max 24)", "opzionale"],
  ])
  XLSX.utils.book_append_sheet(workbook, example, "Istruzioni")
  XLSX.writeFile(workbook, "modello-import-turni-libro-paga.xlsx")
}

export function parseLibroPagaTurniExcel(
  buffer: ArrayBuffer,
  personale: LpagaPersonale[],
  livelli: LpagaLivello[],
  existing: LpagaTurnoRow[]
): ImportTurnoExcelPreview[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""]
  if (!sheet) throw new Error("Il file Excel non contiene fogli.")
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true })
  if (!rows.length) throw new Error("Il file Excel è vuoto.")
  const headers = (rows[0] ?? []).map((cell) => normalized(String(cell ?? "")))
  const col = (names: string[]) => headers.findIndex((h) => names.includes(h))
  const columns = {
    giorno: col(["data", "giorno", "data turno"]),
    personale: col(["collaboratore", "dipendente", "personale", "nominativo", "nome"]),
    mansione: col(["mansione", "livello", "attivita", "attivita lavorativa"]),
    quantita: col(["quantita", "ore", "valore", "servizi"]),
    note: col(["note", "descrizione"]),
  }
  const required = [
    ["Data", columns.giorno],
    ["Collaboratore", columns.personale],
    ["Mansione", columns.mansione],
    ["Quantità", columns.quantita],
  ] as const
  const missing = required.filter(([, index]) => index < 0).map(([label]) => label)
  if (missing.length) throw new Error(`Colonne mancanti: ${missing.join(", ")}.`)

  const activePersonnel = personale.filter((row) => row.attivo)
  const activeLevels = livelli.filter((row) => row.attivo && row.retribuibile)
  const seen = new Set(
    existing.map((row) =>
      duplicateKey({
        giorno: row.giorno.slice(0, 10),
        personaleId: row.personaleId,
        livelloId: row.livelloId,
        quantita: row.quantita,
        note: row.note ?? "",
      })
    )
  )
  return rows.slice(1).flatMap((cells, index) => {
    const cell = (index: number) => (index >= 0 ? cells[index] : "")
    if (!cells.some((value) => String(value ?? "").trim())) return []
    const giorno = parseDate(cell(columns.giorno))
    const personaleName = String(cell(columns.personale) ?? "").trim()
    const livelloName = String(cell(columns.mansione) ?? "").trim()
    const quantita = parseQuantity(cell(columns.quantita))
    const note = String(cell(columns.note) ?? "").trim()
    const person = resolveByName(personaleName, activePersonnel, (row) => row.nominativo || `${row.nome} ${row.cognome ?? ""}`)
    const level = resolveByName(livelloName, activeLevels, (row) => row.nome)
    const errors: string[] = []
    if (!giorno) errors.push("Data non valida (usa gg/mm/aaaa)")
    if (!person) errors.push(personaleName ? "Collaboratore non trovato o nome non univoco" : "Collaboratore mancante")
    if (!level) errors.push(livelloName ? "Mansione non trovata o non retribuibile" : "Mansione mancante")
    if (!Number.isFinite(quantita) || quantita <= 0 || quantita > 24) errors.push("Quantità non valida (0–24)")
    const preview: ImportTurnoExcelPreview = {
      riga: index + 2,
      giorno,
      personale: personaleName,
      personaleId: person?.id,
      mansione: livelloName,
      livelloId: level?.id,
      quantita,
      note,
      ...(errors.length ? { errore: errors.join("; ") } : {}),
    }
    if (!preview.errore) {
      const key = duplicateKey(preview)
      if (seen.has(key)) preview.duplicato = true
      else seen.add(key)
    }
    return [preview]
  })
}
