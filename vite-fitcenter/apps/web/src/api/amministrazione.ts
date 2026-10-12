import { api } from "./client"
import { getApiBase } from "./baseUrl"

export type AmmRepartoTipo = "operativo" | "struttura"
export type AmmLivello = "macro" | "sotto"
export type AmmTipoCosto = "fisso" | "variabile"

export type AmmReparto = {
  id: string
  codice: string
  nome: string
  tipo: AmmRepartoTipo
  livello: AmmLivello
  macroId?: string
  note?: string
  attivo: boolean
  ordine: number
}

export type AmmFornitore = { id: string; ragioneSociale: string }

export type AmmQuota = { repartoId: string; percentuale: number }

export type AmmSpesa = {
  id: string
  fornitore: string
  fornitoreId?: string
  numeroDocumento: string
  dataDocumento: string
  descrizione: string
  totale: number
  tipoCosto: AmmTipoCosto
  quote: AmmQuota[]
  pathPdf?: string
  origine: "manuale" | "ocr" | "excel"
  createdAt: string
  updatedAt: string
}

export type AmmDashRiga = { id: string; nome: string; importo: number; macroId?: string }

export type AmmDashboard = {
  anno: number
  mese: string | null
  repartoId: string | null
  tot: number
  totFisso: number
  totVariabile: number
  totSpese: number
  totCollaboratori: number
  byMacro: AmmDashRiga[]
  byReparto: AmmDashRiga[]
  byMese: { mese: string; label: string; importo: number }[]
  nSpese: number
}

export type AmmOcrParsed = {
  fornitore: string
  numeroDocumento: string
  dataDocumento: string
  totale: number | null
  descrizione: string
}

export type AmmImportEsito = {
  inserite: number
  saltate: number
  errori: { riga: number; message: string }[]
}

function token(): string | null {
  try {
    return localStorage.getItem("fitcenter-token")
  } catch {
    return null
  }
}

export const amministrazioneApi = {
  dashboard: (anno: number, mese?: string, reparto?: string) => {
    const q = new URLSearchParams({ anno: String(anno) })
    if (mese) q.set("mese", mese)
    if (reparto) q.set("reparto", reparto)
    return api.get<AmmDashboard>(`/amministrazione/dashboard?${q}`)
  },
  meta: () => api.get<{ reparti: AmmReparto[]; fornitori: AmmFornitore[] }>("/amministrazione/reparti"),
  saveReparto: (body: Partial<AmmReparto> & { nome: string }) =>
    api.put<{ reparto: AmmReparto }>("/amministrazione/reparti", body),
  listSpese: (mese?: string, q?: string) => {
    const p = new URLSearchParams()
    if (mese) p.set("mese", mese)
    if (q) p.set("q", q)
    const s = p.toString()
    return api.get<{ spese: AmmSpesa[] }>(`/amministrazione/spese${s ? `?${s}` : ""}`)
  },
  saveSpesa: async (body: Partial<AmmSpesa> & { fornitore: string; dataDocumento: string; totale: number; quote: AmmQuota[] }, pdf?: File | null) => {
    const fd = new FormData()
    fd.append("payload", JSON.stringify(body))
    if (pdf) fd.append("pdf", pdf)
    const path = body.id ? `/amministrazione/spese/${encodeURIComponent(body.id)}` : "/amministrazione/spese"
    return body.id ? api.put<{ spesa: AmmSpesa }>(path, fd) : api.post<{ spesa: AmmSpesa }>(path, fd)
  },
  importSpese: (righe: unknown[]) => api.post<AmmImportEsito>("/amministrazione/spese/import", { righe }),
  deleteSpesa: (id: string) => api.delete<{ ok: boolean }>(`/amministrazione/spese/${encodeURIComponent(id)}`),
  ocr: (text: string, filename?: string) =>
    api.post<{ parsed: AmmOcrParsed; fornitoreNoto: AmmFornitore | null; fornitori: AmmFornitore[] }>(
      "/amministrazione/ocr",
      { text, filename }
    ),
  pdfUrl: (id: string) => `${getApiBase()}/amministrazione/spese/${encodeURIComponent(id)}/pdf`,
  openPdf: async (id: string) => {
    const res = await fetch(amministrazioneApi.pdfUrl(id), {
      headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    })
    if (!res.ok) throw new Error("PDF non disponibile")
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, "_blank", "noopener")
  },
}
