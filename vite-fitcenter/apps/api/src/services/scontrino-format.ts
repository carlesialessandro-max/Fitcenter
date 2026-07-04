import type { RicevutaUtenteGroup } from "./gestionale-sql.js"

function fmtEuro(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0)
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString("it-IT")
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("it-IT")
}

function clienteLabel(g: RicevutaUtenteGroup): string {
  const c = (g.cliente ?? "").trim()
  if (c) return c
  const nome = `${g.cognome ?? ""} ${g.nome ?? ""}`.trim()
  if (nome) return nome
  if (g.senzaNominativo) {
    const desc = g.righe[0]?.descrizione?.trim()
    if (desc) return `Ticket — ${desc}`
    return "Senza nominativo"
  }
  return "Cliente"
}

export function formatScontrinoEmail(g: RicevutaUtenteGroup): { subject: string; text: string } {
  const a = g.azienda
  const indirizzoAzienda = [a.indirizzoVia, a.indirizzoCap, a.indirizzoCitta, a.indirizzoPv].filter(Boolean).join(" ")
  const righe = g.righe
    .map((r) => {
      const desc = (r.descrizione ?? "—").trim()
      const qta = r.qta > 0 ? `${r.qta} x ` : ""
      return `${qta}${desc}  ${fmtEuro(r.totaleRiga)}`
    })
    .join("\n")

  const lines = [
    a.nome?.trim() || "FitCenter",
    indirizzoAzienda,
    [a.telefono, a.email, a.piva ? `P.IVA ${a.piva}` : ""].filter(Boolean).join(" · "),
    "",
    `Scontrino n. ${g.numeroRicevuta ?? g.ricevutaId}`,
    `Data: ${fmtDateTime(g.dataRicevutaIso)}`,
    g.tipoRicevuta ? `Tipo: ${g.tipoRicevuta}` : "",
    g.tipoPagamento ? `Pagamento: ${g.tipoPagamento}` : "",
    "",
    `Cliente: ${clienteLabel(g)}${g.senzaNominativo ? " (ticket / senza nominativo)" : ""}`,
    "",
    righe,
    "",
    `TOTALE: ${fmtEuro(g.totale)}`,
    g.noteGenerali?.trim() ? `\nNote: ${g.noteGenerali.trim()}` : "",
    g.operatore?.trim() ? `\nOperatore: ${g.operatore.trim()}` : "",
    "",
    "Documento non fiscale inviato per comodità. Conservare per eventuali verifiche.",
  ].filter((x) => x !== "")

  const subject = `Scontrino ${g.numeroRicevuta ?? g.ricevutaId} — ${fmtEuro(g.totale)}`
  return { subject, text: lines.join("\n") }
}

/** Testo compatto per SMS (max ~480 caratteri). */
export function formatScontrinoSms(g: RicevutaUtenteGroup): string {
  const nome = g.azienda.nome?.trim() || "FitCenter"
  const primaRiga = g.righe[0]?.descrizione?.trim()
  const extra = g.righe.length > 1 ? ` (+${g.righe.length - 1} righe)` : ""
  let text = `${nome}: scontrino n.${g.numeroRicevuta ?? g.ricevutaId} del ${fmtDate(g.dataRicevutaIso)} — ${fmtEuro(g.totale)}`
  if (primaRiga) text += `. ${primaRiga.slice(0, 60)}${extra}`
  if (text.length > 480) text = text.slice(0, 477) + "..."
  return text
}
