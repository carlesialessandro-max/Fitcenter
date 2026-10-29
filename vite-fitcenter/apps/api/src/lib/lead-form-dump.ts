export type LeadFormDump = {
  referente: string
  allievo: string
  altro: string
  disponibilita: string
  note: string
  telefono: string
}

function isDash(s: string): boolean {
  const t = s.trim()
  return !t || t === "-" || t === "—"
}

function isPhoneToken(s: string): boolean {
  const digits = s.replace(/\D/g, "")
  return digits.length >= 8 && digits.length <= 15
}

/** Form Facebook corsi: referente, allievo (età), altro, giorni, note, telefono. */
export function parseLeadFormDump(raw: string): LeadFormDump | null {
  const s = String(raw ?? "").trim()
  if (!s.includes(",")) return null
  const parts = s.split(",").map((x) => x.trim())
  const last = parts[parts.length - 1] ?? ""
  if (!isPhoneToken(last) || parts.length < 5) return null
  const hasAge = parts.some((p) => /\(\s*\d+\s*anni?\.?\s*\)/i.test(p))
  if (!hasAge && parts.length < 6) return null
  const body = parts.slice(0, -1)
  if (body.length < 4) return null
  return {
    referente: body[0] ?? "",
    allievo: body[1] ?? "",
    altro: isDash(body[2] ?? "") ? "" : (body[2] ?? ""),
    disponibilita: isDash(body[3] ?? "") ? "" : (body[3] ?? ""),
    note: body
      .slice(4)
      .filter((x) => !isDash(x))
      .join(", "),
    telefono: last.replace(/\D/g, ""),
  }
}

export function firstNameFromLeadNome(nome: string): string {
  const dump = parseLeadFormDump(nome)
  const base = (dump?.referente || String(nome ?? "").split(",")[0] || "").trim()
  const first = base.split(/\s+/)[0]?.replace(/[()]/g, "") ?? ""
  if (!first || /^ciao$/i.test(first) || first === "—") return "Ciao"
  return first
}

export function formatLeadFormDumpNote(d: LeadFormDump): string {
  const lines = [
    d.allievo ? `Allievo: ${d.allievo}` : "",
    d.referente ? `Referente: ${d.referente}` : "",
    d.altro ? `Altro contatto: ${d.altro}` : "",
    d.disponibilita ? `Disponibilità: ${d.disponibilita}` : "",
    d.note ? `Richiesta: ${d.note}` : "",
  ].filter(Boolean)
  return lines.join("\n")
}
