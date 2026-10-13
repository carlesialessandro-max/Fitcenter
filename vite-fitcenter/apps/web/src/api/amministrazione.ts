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
  origine: "manuale" | "ocr" | "excel" | "fattureincloud"
  ficId?: number
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
  totBuste: number
  totPersonale: number
  byMacro: AmmDashRiga[]
  byReparto: AmmDashRiga[]
  byMese: { mese: string; label: string; importo: number }[]
  byCollaboratori: AmmDashRiga[]
  byBuste: AmmDashRiga[]
  nSpese: number
  nBuste: number
}

export type AmmBusta = {
  id: string
  nominativo: string
  mese: string
  descrizione: string
  totale: number
  quote: AmmQuota[]
  origine: "manuale" | "mastrino" | "pdf"
  createdAt: string
  updatedAt: string
}

export type AmmStipendiPdfRiga = {
  nominativo: string
  mese: string
  totale: number
  descrizione: string
  tipo: "sportivo" | "gestionale" | "dipendente"
  quote: AmmQuota[]
}

export type AmmOcrParsed = {
  fornitore: string
  numeroDocumento: string
  dataDocumento: string
  totale: number | null
  descrizione: string
}

export type AmmCollaboratoreRiga = {
  id: string
  nominativo: string
  mese: string
  totale: number
  tipo: "sportivo" | "gestionale"
}

export type AmmCollabReportRiga = {
  nominativo: string
  tipo: "sportivo" | "gestionale"
  mesi: Record<string, { id: string; totale: number; origine: string }>
  tot: number
  oltre5000: number
  oltre15000: number
}

export type AmmCollabAudit = {
  id: string
  at: string
  user: string
  nominativo: string
  mese: string
  da: number | null
  a: number | null
  azione: "importo" | "aggiunto" | "eliminato"
}

export type AmmCollabReport = {
  anno: number
  mesi: { id: string; label: string }[]
  righe: AmmCollabReportRiga[]
  totMese: Record<string, number>
  totAnno: number
  n: number
  audit: AmmCollabAudit[]
}

export type AmmImportEsito = {
  inserite: number
  saltate: number
  sostituite?: number
  errori: { riga: number; message: string }[]
  lette?: number
  companyName?: string
}

export type AmmFicStatus = {
  connected: boolean
  fromEnv: boolean
  companyId: number | null
  companyName: string
  tokenMasked: string
  defaultRepartoId: string
  lastSyncAt: string | null
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
  listBuste: (mese?: string) => {
    const s = mese ? `?mese=${encodeURIComponent(mese)}` : ""
    return api.get<{ buste: AmmBusta[] }>(`/amministrazione/buste${s}`)
  },
  saveBusta: (body: Partial<AmmBusta> & { nominativo: string; mese: string; totale: number; quote: AmmQuota[] }) =>
    body.id
      ? api.put<{ busta: AmmBusta }>(`/amministrazione/buste/${encodeURIComponent(body.id)}`, body)
      : api.post<{ busta: AmmBusta }>("/amministrazione/buste", body),
  deleteBusta: (id: string) => api.delete<{ ok: boolean }>(`/amministrazione/buste/${encodeURIComponent(id)}`),
  importBuste: (righe: unknown[]) => api.post<AmmImportEsito>("/amministrazione/buste/import", { righe }),
  parseStipendiPdf: (text: string, filename: string, mese: string) =>
    api.post<{
      mese: string
      sportivi: AmmStipendiPdfRiga[]
      gestionali: AmmStipendiPdfRiga[]
      dipendenti: AmmStipendiPdfRiga[]
      totSportivi: number
      totGestionali: number
      totDipendenti: number
    }>("/amministrazione/stipendi/pdf", { text, filename, mese }),
  importCollaboratori: (righe: unknown[]) => api.post<AmmImportEsito>("/amministrazione/collaboratori/import", { righe }),
  deleteCollaboratore: (id: string) => api.delete<{ ok: boolean }>(`/amministrazione/collaboratori/${encodeURIComponent(id)}`),
  reportCollaboratori: (anno: number) =>
    api.get<AmmCollabReport>(`/amministrazione/collaboratori/report?anno=${encodeURIComponent(String(anno))}`),
  setImportoCollaboratore: (body: { nominativo: string; mese: string; totale: number; tipo?: "sportivo" | "gestionale" }) =>
    api.post<{ row: AmmCollaboratoreRiga }>(`/amministrazione/collaboratori/importo`, body),
  importCollaboratoriReport: (anno: number, righe: unknown[]) =>
    api.post<AmmImportEsito & { nPersone?: number }>("/amministrazione/collaboratori/report/import", { anno, righe }),
  collaboratori: (anno: number, mese?: string) => {
    const q = new URLSearchParams({ anno: String(anno) })
    if (mese) q.set("mese", mese)
    return api.get<{
      anno: number
      mese: string | null
      tot: number
      fonte?: "riepilogo" | "libro-paga"
      righe: { id: string; nome: string; macroId?: string; importo: number; nTurni: number; tipo?: string; descrizione?: string }[]
    }>(`/amministrazione/collaboratori?${q}`)
  },
  deleteSpesa: (id: string) => api.delete<{ ok: boolean }>(`/amministrazione/spese/${encodeURIComponent(id)}`),
  ocr: (text: string, filename?: string) =>
    api.post<{ parsed: AmmOcrParsed; fornitoreNoto: AmmFornitore | null; fornitori: AmmFornitore[] }>(
      "/amministrazione/ocr",
      { text, filename }
    ),
  ficStatus: () => api.get<AmmFicStatus>("/amministrazione/fattureincloud"),
  ficConnect: (body: { accessToken?: string; companyId?: number; defaultRepartoId?: string }) =>
    api.post<AmmFicStatus>("/amministrazione/fattureincloud/connect", body),
  ficDisconnect: () => api.post<AmmFicStatus>("/amministrazione/fattureincloud/disconnect", {}),
  ficSync: (mese: string, repartoId?: string) =>
    api.post<AmmImportEsito>("/amministrazione/fattureincloud/sync", { mese, repartoId }),
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
