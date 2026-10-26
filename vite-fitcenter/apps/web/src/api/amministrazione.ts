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

export type AmmFornitoreQuoteMeta = {
  chiave: string
  ragioneSociale: string
  quote: AmmQuota[]
  stagionale?: "piscina-estate"
}

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
  quoteEccezione?: boolean
  pathPdf?: string
  origine: "manuale" | "ocr" | "excel" | "fattureincloud"
  ficId?: number
  createdAt: string
  updatedAt: string
}

export type AmmDashRiga = { id: string; nome: string; importo: number; macroId?: string }

export type AmmRisultatoReparto = {
  id: string
  nome: string
  ricavi: number
  costiDiretti: number
  quotaFissi: number
  quotaServizi?: number
  costoTotale: number
  utile: number
  marginePct: number | null
  ripartoFissiPct: number
}

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
  ricaviDisponibili?: boolean
  ricaviErrore?: string
  totRicavi?: number
  totRicaviAltri?: number
  totRicaviDanza?: number
  nFattureDanza?: number
  totRecuperiUtenze?: number
  fattureEmesseDettaglio?: {
    numeroDocumento: string
    dataDocumento: string
    cliente: string
    descrizione: string
    tipo: "Danza" | "Recupero utenze" | "Affitto spazi" | "Convenzione"
    totale: number
  }[]
  totRicaviAzienda: number
  totCostiAzienda: number
  totCostiFuoriReparti: number
  totUtileAzienda: number
  margineAziendaPct: number | null
  totStruttura?: number
  totServizi?: number
  totCostoPnl?: number
  totUtile?: number
  marginePct?: number | null
  strutturaByMacro?: AmmDashRiga[]
  serviziByMacro?: AmmDashRiga[]
  risultato?: AmmRisultatoReparto[]
  ricaviDettaglio?: {
    voce: string
    macro: string
    importo: number
    n: number
    ripartizione: { macro: string; importo: number }[]
  }[]
}

export type AmmBusta = {
  id: string
  nominativo: string
  mese: string
  descrizione: string
  totale: number
  quote: AmmQuota[]
  origine: "manuale" | "mastrino" | "pdf"
  dettaglioDipendenti?: { nominativo: string; totale: number }[]
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
  dettaglioDipendenti?: { nominativo: string; totale: number }[]
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

export type AmmCollaboratoreRimborso = {
  id: string
  nominativo: string
  mese: string
  descrizione: string
  totale: number
  quote: AmmQuota[]
}

export type AmmCollabReportRiga = {
  nominativo: string
  tipo: "sportivo" | "gestionale"
  reparto?: string
  mansione?: string
  mesi: Record<string, { id: string; totale: number; origine: string }>
  rimanenze: number
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
  totRimanenze?: number
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
  meta: () => api.get<{ reparti: AmmReparto[]; fornitori: AmmFornitore[]; fornitoriQuote?: AmmFornitoreQuoteMeta[] }>(
    "/amministrazione/reparti"
  ),
  saveReparto: (body: Partial<AmmReparto> & { nome: string }) =>
    api.put<{ reparto: AmmReparto }>("/amministrazione/reparti", body),
  listSpese: (mese?: string, q?: string) => {
    const p = new URLSearchParams()
    if (mese) p.set("mese", mese)
    if (q) p.set("q", q)
    const s = p.toString()
    return api.get<{ spese: AmmSpesa[] }>(`/amministrazione/spese${s ? `?${s}` : ""}`)
  },
  saveSpesa: async (
    body: Partial<AmmSpesa> & {
      fornitore: string
      dataDocumento: string
      totale: number
      quote: AmmQuota[]
      rememberQuote?: boolean
    },
    pdf?: File | null
  ) => {
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
  importBustaConsuntivo: (riga: AmmStipendiPdfRiga) =>
    api.post<AmmImportEsito & { busta: AmmBusta }>("/amministrazione/buste/consuntivo/import", { riga }),
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
  setCentroCostoCollaboratore: (nominativo: string, repartoId: string) =>
    api.put<{ row: { nominativo: string; repartoId: string; updatedAt: string } }>(
      "/amministrazione/collaboratori/centro-costo",
      { nominativo, repartoId },
    ),
  saveCollaboratoreRimborso: (body: { nominativo: string; mese: string; descrizione: string; totale: number }) =>
    api.post<{ rimborso: AmmCollaboratoreRimborso }>("/amministrazione/collaboratori/rimborsi", body),
  deleteCollaboratoreRimborso: (id: string) =>
    api.delete<{ ok: boolean }>(`/amministrazione/collaboratori/rimborsi/${encodeURIComponent(id)}`),
  reportCollaboratori: (anno: number) =>
    api.get<AmmCollabReport>(`/amministrazione/collaboratori/report?anno=${encodeURIComponent(String(anno))}`),
  setImportoCollaboratore: (body: { nominativo: string; mese: string; totale: number; tipo?: "sportivo" | "gestionale" }) =>
    api.post<{ row: AmmCollaboratoreRiga }>(`/amministrazione/collaboratori/importo`, body),
  setRimanenzeCollaboratore: (body: { nominativo: string; anno: number; importo: number }) =>
    api.post<{ row: { nominativo: string; anno: number; importo: number } | null }>(
      `/amministrazione/collaboratori/rimanenze`,
      body
    ),
  importCollaboratoriReport: (anno: number, righe: unknown[], rimanenze?: unknown[]) =>
    api.post<AmmImportEsito & { nPersone?: number }>("/amministrazione/collaboratori/report/import", {
      anno,
      righe,
      rimanenze,
    }),
  collaboratori: (anno: number, mese?: string) => {
    const q = new URLSearchParams({ anno: String(anno) })
    if (mese) q.set("mese", mese)
    return api.get<{
      anno: number
      mese: string | null
      tot: number
      totRimborsi: number
      rimborsi: AmmCollaboratoreRimborso[]
      fonte?: "riepilogo" | "nessuno" | "libro-paga" | "libro-paga-mensilita"
      righe: {
        id: string
        nome: string
        macroId?: string
        importo: number
        nTurni: number
        tipo?: string
        descrizione?: string
        quote?: AmmQuota[]
        repartoId?: string
        repartoDaLibroPaga?: boolean
        ripartizioneDaTurni?: boolean
      }[]
    }>(`/amministrazione/collaboratori?${q}`)
  },
  deleteSpesa: (id: string) => api.delete<{ ok: boolean }>(`/amministrazione/spese/${encodeURIComponent(id)}`),
  ocr: (text: string, filename?: string) =>
    api.post<{
      parsed: AmmOcrParsed
      fornitoreNoto: AmmFornitore | null
      fornitori: AmmFornitore[]
      quoteSuggerite?: AmmQuota[]
    }>("/amministrazione/ocr", { text, filename }),
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
