import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { prenotazioniApi, type AccessoUtenteRow, type PrenotazioneCorsoRow } from "@/api/prenotazioni"
import { useAuth } from "@/contexts/AuthContext"
import { whatsAppMeUrl } from "@/lib/whatsappPhone"

function isoToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function monthRangeFromDay(dayIso: string): { from: string; to: string; monthKey: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayIso)
  if (!m) return { from: dayIso, to: dayIso, monthKey: dayIso.slice(0, 7) }
  const y = Number(m[1])
  const mo = Number(m[2]) // 1..12
  const from = `${m[1]}-${m[2]}-01`
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate() // day 0 of next month = last day of current month
  const to = `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`
  return { from, to, monthKey: `${m[1]}-${m[2]}` }
}

function fmtDateIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

function fmtTimeDot(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  return m ? `${m[1]}.${m[2]}` : hhmm
}

type CorsoGroup = {
  key: string
  servizio: string
  giorno: string
  oraInizio?: string
  oraFine?: string
  partecipanti: PrenotazioneCorsoRow[]
}

function firstNonEmptyStr(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : String(v ?? "").trim()
  return s ? s : undefined
}

function getCorsoTitolo(r: PrenotazioneCorsoRow): string {
  const raw = (r.raw ?? {}) as any
  return (
    firstNonEmptyStr(r.servizio) ??
    firstNonEmptyStr(raw?.PrenotazioneDescrizione) ??
    firstNonEmptyStr(raw?.ServizioDescrizione) ??
    firstNonEmptyStr(raw?.DescrizioneServizio) ??
    firstNonEmptyStr(raw?.NomeServizio) ??
    firstNonEmptyStr(raw?.AttivitaDescrizione) ??
    firstNonEmptyStr(raw?.DescrizioneAttivita) ??
    firstNonEmptyStr(raw?.CorsoDescrizione) ??
    firstNonEmptyStr(raw?.DescrizioneCorso) ??
    firstNonEmptyStr(raw?.NomeCorso) ??
    firstNonEmptyStr(raw?.Corso) ??
    "—"
  )
}

function groupByCorso(rows: PrenotazioneCorsoRow[]): CorsoGroup[] {
  const map = new Map<string, CorsoGroup>()
  const byBase = new Map<string, CorsoGroup[]>() // servizio+giorno -> gruppi (per agganciare attese senza orario)
  for (const r of rows) {
    const servizio = getCorsoTitolo(r)
    const giorno = (r.giorno ?? "").trim() || "—"
    const oraInizio = (r.oraInizio ?? "").trim() || undefined
    const oraFine = (r.oraFine ?? "").trim() || undefined
    const isWait = !!r.inAttesa
    const waitNoTime = isWait && (!oraInizio || oraInizio === "00:00")

    // Se è in attesa e non ha un orario affidabile, prova ad agganciarla al corso del giorno con stesso servizio.
    if (waitNoTime) {
      const baseKey = `${servizio}__${giorno}`
      const candidates = byBase.get(baseKey) ?? []
      if (candidates.length > 0) {
        // Se ci sono più gruppi (stesso corso, più orari), aggancia al primo in ordine di ora.
        const pick = [...candidates].sort((a, b) => (a.oraInizio ?? "").localeCompare(b.oraInizio ?? ""))[0]!
        pick.partecipanti.push(r)
        continue
      }
    }

    const key = `${servizio}__${giorno}__${oraInizio ?? ""}__${oraFine ?? ""}`
    const g = map.get(key)
    if (!g) {
      const created = { key, servizio, giorno, oraInizio, oraFine, partecipanti: [r] }
      map.set(key, created)
      const baseKey = `${servizio}__${giorno}`
      byBase.set(baseKey, [...(byBase.get(baseKey) ?? []), created])
    } else {
      g.partecipanti.push(r)
    }
  }
  const list = Array.from(map.values())
  list.sort((a, b) => {
    // Ordine richiesto: data + orario (non alfabetico per corso)
    const d = a.giorno.localeCompare(b.giorno)
    if (d) return d
    const o = (a.oraInizio ?? "").localeCompare(b.oraInizio ?? "")
    if (o) return o
    const f = (a.oraFine ?? "").localeCompare(b.oraFine ?? "")
    if (f) return f
    return a.servizio.localeCompare(b.servizio)
  })
  for (const g of list) {
    g.partecipanti.sort((x, y) => {
      const px = Number((x.raw as any)?.Progressivo ?? (x.raw as any)?.progressivo)
      const py = Number((y.raw as any)?.Progressivo ?? (y.raw as any)?.progressivo)
      if (Number.isFinite(px) && Number.isFinite(py) && px !== py) return px - py
      // Metti in attesa dopo i prenotati, a parità di progressivo.
      const wx = x.inAttesa ? 1 : 0
      const wy = y.inAttesa ? 1 : 0
      if (wx !== wy) return wx - wy
      // In lista d'attesa, ordina per data prenotazione (non alfabetico).
      if (x.inAttesa && y.inAttesa) {
        const dx = x.prenotatoIl ? new Date(x.prenotatoIl).getTime() : Number.POSITIVE_INFINITY
        const dy = y.prenotatoIl ? new Date(y.prenotatoIl).getTime() : Number.POSITIVE_INFINITY
        if (Number.isFinite(dx) && Number.isFinite(dy) && dx !== dy) return dx - dy
      }
      const cx = (x.cognome ?? "").localeCompare(y.cognome ?? "")
      if (cx) return cx
      return (x.nome ?? "").localeCompare(y.nome ?? "")
    })
  }
  return list
}

function uniqueValidEmails(part: PrenotazioneCorsoRow[]): string[] {
  const s = new Set<string>()
  const out: string[] = []
  for (const p of part) {
    const e = (p.email ?? "").trim()
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue
    const k = e.toLowerCase()
    if (s.has(k)) continue
    s.add(k)
    out.push(e)
  }
  return out
}

function participantStableKey(p: PrenotazioneCorsoRow, idx: number): string {
  const raw = (p.raw ?? {}) as any
  const id =
    firstNonEmptyStr(raw?.IDCliente) ??
    firstNonEmptyStr(raw?.ClienteId) ??
    firstNonEmptyStr(raw?.IdCliente) ??
    firstNonEmptyStr(raw?.IDUtente) ??
    firstNonEmptyStr(raw?.UtenteId) ??
    firstNonEmptyStr(raw?.IdUtente) ??
    firstNonEmptyStr(raw?.IDAnagrafica) ??
    firstNonEmptyStr(raw?.AnagraficaId) ??
    firstNonEmptyStr(raw?.IDSocio) ??
    firstNonEmptyStr(raw?.SocioId)
  if (id) return `id:${id}`
  const nome = `${p.cognome ?? ""}|${p.nome ?? ""}`.trim()
  const em = (p.email ?? "").trim().toLowerCase()
  const sms = (p.sms ?? "").trim().replace(/\s+/g, "")
  // Nota: non includiamo più idx per rendere la chiave stabile tra viste/ordinamenti (serve anche per analisi mese).
  // Possibili collisioni sono rare (nome+email/sms).
  void idx
  return `fallback:${nome}|${em}|${sms}`
}

function groupKeyForRow(p: PrenotazioneCorsoRow): string {
  const servizio = getCorsoTitolo(p)
  const giorno = (p.giorno ?? "").trim() || "—"
  const oraInizio = (p.oraInizio ?? "").trim() || ""
  const oraFine = (p.oraFine ?? "").trim() || ""
  return `${servizio}__${giorno}__${oraInizio}__${oraFine}`
}

function legacyParticipantKey(p: PrenotazioneCorsoRow, idx: number): string {
  // Chiave usata nelle versioni precedenti (includeva idx sempre).
  const nome = `${p.cognome ?? ""}|${p.nome ?? ""}`.trim()
  const em = (p.email ?? "").trim().toLowerCase()
  const sms = (p.sms ?? "").trim().replace(/\s+/g, "")
  return `fallback:${nome}|${em}|${sms}|${idx}`
}

function readAppelloForDay(giornoIso: string): Record<string, true> {
  try {
    const raw = localStorage.getItem(`fitcenter-corsi-appello:${giornoIso}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, true>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function parseDateAny(val: unknown): Date | null {
  if (val == null) return null
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val
  const s = String(val).trim()
  if (!s) return null
  // Supporta formato IT dd/MM/yyyy HH:mm(:ss) o HH.mm(.ss)
  const sNorm = s.replace(/(\d{1,2})\.(\d{2})(?:\.(\d{2}))?$/, (_m, h, mi, ss) => `${h}:${mi}${ss ? `:${ss}` : ""}`)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:\.](\d{2})(?:[:\.](\d{2}))?)?$/.exec(sNorm)
  if (m) {
    const dd = Number(m[1])
    const mm = Number(m[2])
    const yyyy = Number(m[3])
    const hh = m[4] != null ? Number(m[4]) : 0
    const mi = m[5] != null ? Number(m[5]) : 0
    const ss = m[6] != null ? Number(m[6]) : 0
    const d = new Date(yyyy, mm - 1, dd, hh, mi, ss)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(sNorm)
  return Number.isNaN(d.getTime()) ? null : d
}

function isoDayLocal(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${mo}-${day}`
}

function getLessonWindow(p: PrenotazioneCorsoRow): { start: Date | null; end: Date | null } {
  const raw = (p.raw ?? {}) as any
  const start =
    parseDateAny(raw?.DataInizioPrenotazioneIscrizione) ??
    parseDateAny(raw?.InizioPrenotazioneIscrizione) ??
    parseDateAny(raw?.DataInizio) ??
    null
  const end =
    parseDateAny(raw?.DataFinePrenotazioneIscrizione) ??
    parseDateAny(raw?.DataFine) ??
    null
  return { start, end }
}

type AccessIndex = Map<string, Date[]> // idKey -> access times (Date)

function buildAccessIndexForDay(rows: AccessoUtenteRow[], giornoIso: string): AccessIndex {
  const m = new Map<string, Date[]>()
  for (const r of rows) {
    const raw = (r.raw ?? {}) as any
    const id = String(r.idUtente ?? raw?.IDUtente ?? raw?.IdUtente ?? raw?.UtenteId ?? "").trim()
    if (!id) continue
    const dt = parseDateAny(r.dataEntrata ?? raw?.AccessiDataOra ?? raw?.AccessiData ?? raw?.AccessiOra)
    if (!dt) continue
    if (isoDayLocal(dt) !== giornoIso) continue
    const k = `id:${id}`
    const list = m.get(k) ?? []
    list.push(dt)
    m.set(k, list)
  }
  for (const [k, list] of m.entries()) {
    list.sort((a, b) => a.getTime() - b.getTime())
    m.set(k, list)
  }
  return m
}

function isPresentByAccess(accessIdx: AccessIndex, p: PrenotazioneCorsoRow, giornoIso: string): { present: boolean; entry: Date | null; exit: Date | null } {
  const stable = participantStableKey(p, 0)
  if (!stable.startsWith("id:")) return { present: false, entry: null, exit: null }
  const times = accessIdx.get(stable) ?? []
  if (times.length === 0) return { present: false, entry: null, exit: null }
  const w = getLessonWindow(p)
  if (!w.start) return { present: false, entry: null, exit: null }
  // Day guard
  if (isoDayLocal(w.start) !== giornoIso) return { present: false, entry: null, exit: null }
  const startMs = w.start.getTime()
  const endMs = (w.end ?? w.start).getTime()
  let entry: Date | null = null
  let exit: Date | null = null
  for (const t of times) {
    const ms = t.getTime()
    if (ms < startMs) continue
    if (ms > endMs) break
    if (!entry) entry = t
    exit = t
  }
  return { present: !!entry, entry, exit }
}

/** Data locale YYYY-MM-DD (allineata al date picker «Giorno»). */
function localYmd(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${mo}-${day}`
}

function hhmmToMinutes(hhmm: string | undefined): number | null {
  if (!hhmm?.trim()) return null
  const m = /^(\d{1,2})[:.](\d{2})/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  return h * 60 + min
}

/** Ora dell’ultimo accesso se coincide con il giorno del corso (fuso locale). */
function getUltimoAccessoInfo(
  p: PrenotazioneCorsoRow,
  giornoIso: string
): { timeLabel: string | null; minutes: number | null } {
  const raw = p.dataUltimoAcesso ?? (p.raw as any)?.DataUltimoAcesso
  if (raw == null) return { timeLabel: null, minutes: null }
  const d = raw instanceof Date ? raw : new Date(raw as string)
  if (Number.isNaN(d.getTime())) return { timeLabel: null, minutes: null }
  if (localYmd(d) !== giornoIso) return { timeLabel: null, minutes: null }
  const mins = d.getHours() * 60 + d.getMinutes()
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return { timeLabel: `${hh}:${mm}`, minutes: mins }
}

/** Se l’ultimo passaggio è prima dell’orario di fine lezione, può essere un’uscita anticipata (euristica). */
function possibileUscitaAnticipata(g: CorsoGroup, p: PrenotazioneCorsoRow): boolean {
  const end = hhmmToMinutes(g.oraFine)
  const acc = getUltimoAccessoInfo(p, g.giorno).minutes
  if (end == null || acc == null) return false
  return acc < end
}

function hasWhatsAppableContacts(g: CorsoGroup): boolean {
  for (const p of g.partecipanti) {
    const raw = (p.sms ?? "").trim()
    if (raw && whatsAppMeUrl(raw, ".")) return true
  }
  return false
}

/** Link WhatsApp per ogni cellulare distinto, usando il testo scelto nel modale. */
function waLinksForGroup(g: CorsoGroup, message: string): { label: string; href: string }[] {
  const seen = new Set<string>()
  const list: { label: string; href: string }[] = []
  for (const p of g.partecipanti) {
    const raw = (p.sms ?? "").trim()
    if (!raw) continue
    const href = whatsAppMeUrl(raw, message)
    if (!href) continue
    const nome = `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || raw
    const key = href.split("?")[0] ?? href
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ label: nome, href })
  }
  return list
}

function defaultMessageBody(g: CorsoGroup): string {
  return `Gentile socio,\n\nTi ricordiamo la lezione «${g.servizio}» in data ${fmtDateIt(g.giorno)}${g.oraInizio ? ` alle ${fmtTimeDot(g.oraInizio)}` : ""}${g.oraFine ? `–${fmtTimeDot(g.oraFine)}` : ""}.\n\nSportivi saluti.`
}

export function Corsi() {
  const queryClient = useQueryClient()
  const { role } = useAuth()
  const [giorno, setGiorno] = useState(() => isoToday())
  const [search, setSearch] = useState("")
  const [messaggiGroup, setMessaggiGroup] = useState<CorsoGroup | null>(null)
  const [messaggiChannel, setMessaggiChannel] = useState<"email" | "whatsapp">("email")
  const [messaggiSubject, setMessaggiSubject] = useState("")
  const [messaggiBody, setMessaggiBody] = useState("")
  const [appello, setAppello] = useState<Record<string, true>>({})
  const [waCursor, setWaCursor] = useState(0)

  const enabled = role === "admin" || role === "corsi" || role === "istruttore"
  const canSendMessages = role === "admin" || role === "corsi"
  const canManageNoShow = canSendMessages

  const { data, isLoading, error } = useQuery({
    queryKey: ["prenotazioni-corsi", giorno],
    queryFn: () => prenotazioniApi.listPrenotazioni(giorno),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const blocksQ = useQuery({
    queryKey: ["corsi-no-show-blocks"],
    queryFn: () => prenotazioniApi.listNoShowBlocks(),
    enabled: canManageNoShow,
    staleTime: 20_000,
  })

  const rangeQ = useQuery({
    queryKey: ["prenotazioni-corsi-range", giorno],
    queryFn: () => {
      const r = monthRangeFromDay(giorno)
      return prenotazioniApi.listPrenotazioniRange({ from: r.from, to: r.to })
    },
    enabled: false,
    retry: false,
    staleTime: 0,
  })

  const accessiDayQ = useQuery({
    queryKey: ["accessi-utenti", giorno],
    queryFn: () => prenotazioniApi.listAccessiRange({ from: giorno, to: giorno }),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const accessiRangeQ = useQuery({
    queryKey: ["accessi-utenti-range", giorno],
    queryFn: () => {
      const r = monthRangeFromDay(giorno)
      return prenotazioniApi.listAccessiRange({ from: r.from, to: r.to })
    },
    enabled: false,
    retry: false,
    staleTime: 0,
  })

  const notifyBlockMutation = useMutation({
    mutationFn: async (input: { email: string; monthKey: string; count: number }) => {
      if (!canManageNoShow) throw new Error("Permessi insufficienti")
      const subject = "Prenotazioni corsi: sospensione per assenze ripetute"
      const text =
        `Gentile socio,\\n\\n` +
        `nel mese ${input.monthKey} risultano ${input.count} prenotazioni a cui non ti sei presentato. ` +
        `Come da regolamento, la possibilità di prenotare i corsi viene temporaneamente sospesa.\\n\\n` +
        `Per informazioni o sblocco, contatta la segreteria.\\n\\n` +
        `Cordiali saluti.`
      return prenotazioniApi.notifyAndBlockNoShow({ email: input.email, subject, text, monthKey: input.monthKey, count: input.count })
    },
    onSuccess: async () => {
      await blocksQ.refetch()
    },
  })

  const notifyMutation = useMutation({
    mutationFn: async () => {
      if (!messaggiGroup) throw new Error("Nessun corso selezionato")
      if (!canSendMessages) throw new Error("Permessi insufficienti")
      return prenotazioniApi.notifyEmail({
        giorno,
        groupKey: messaggiGroup.key,
        subject: messaggiSubject.trim(),
        text: messaggiBody.trim(),
      })
    },
    onSuccess: () => {
      setMessaggiGroup(null)
      void queryClient.invalidateQueries({ queryKey: ["prenotazioni-corsi", giorno] })
    },
  })

  const rows = data?.rows ?? []
  const gruppi = useMemo(() => groupByCorso(rows), [rows])
  const accessIdxDay = useMemo(() => buildAccessIndexForDay(accessiDayQ.data?.rows ?? [], giorno), [accessiDayQ.data, giorno])
  const gruppiFiltrati = useMemo(() => {
    const q = search.trim().toLocaleLowerCase()
    if (!q) return gruppi
    return gruppi.filter((g) => g.servizio.toLocaleLowerCase().includes(q))
  }, [gruppi, search])

  /** Quante prenotazioni (corsi distinti) ha lo stesso partecipante nello stesso giorno. */
  const prenotazioniPerPartecipante = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of gruppi) {
      if (g.giorno !== giorno) continue
      g.partecipanti.forEach((p, idx) => {
        const k = participantStableKey(p, idx)
        m.set(k, (m.get(k) ?? 0) + 1)
      })
    }
    return m
  }, [gruppi, giorno])
  const totalePartecipanti = useMemo(
    () => gruppi.reduce((s, g) => s + g.partecipanti.length, 0),
    [gruppi]
  )
  void data?.meta

  const blockedByEmail = useMemo(() => {
    const m = new Map<string, true>()
    for (const b of blocksQ.data?.rows ?? []) {
      const e = String(b.email ?? "").trim().toLowerCase()
      if (e) m.set(e, true)
    }
    return m
  }, [blocksQ.data])

  const noShowCandidates = useMemo(() => {
    const r = monthRangeFromDay(giorno)
    const all = rangeQ.data?.rows ?? []
    if (!rangeQ.data || !accessiRangeQ.data) return []
    // index: giornoIso -> idKey -> access times
    const byDay = new Map<string, AccessIndex>()
    // Index accessi per giorno (derivato da AccessiDataOra).
    const allAccessRows = accessiRangeQ.data?.rows ?? []
    const daySet = new Set<string>()
    for (const a of allAccessRows) {
      const dt = parseDateAny((a.raw as any)?.AccessiDataOra ?? a.dataEntrata)
      if (!dt) continue
      daySet.add(isoDayLocal(dt))
    }
    for (const dayIso of daySet) {
      const dayRows = allAccessRows.filter((a) => {
        const dt = parseDateAny((a.raw as any)?.AccessiDataOra ?? a.dataEntrata)
        return dt ? isoDayLocal(dt) === dayIso : false
      })
      byDay.set(dayIso, buildAccessIndexForDay(dayRows, dayIso))
    }
    const counts = new Map<
      string,
      { key: string; email: string; name: string; count: number }
    >()
    for (const p of all) {
      if (p.inAttesa) continue
      const w = getLessonWindow(p)
      const day = w.start ? isoDayLocal(w.start) : ""
      if (!day) continue
      const key = participantStableKey(p, 0)
      const email = (p.email ?? "").trim().toLowerCase()
      const name = `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || email || "—"
      const gk = groupKeyForRow(p)
      const pk = participantStableKey(p, 0)
      const appello = readAppelloForDay(day)
      const presenteAppello = !!appello[`${gk}::${pk}`]
      const accIdx = byDay.get(day) ?? new Map()
      const presenteAccessi = isPresentByAccess(accIdx, p, day).present
      const presente = presenteAppello || presenteAccessi
      if (!presente) {
        const cur = counts.get(key) ?? { key, email, name, count: 0 }
        cur.count += 1
        // tieni email se prima vuota e poi appare
        if (!cur.email && email) cur.email = email
        if (cur.name === "—" && name && name !== "—") cur.name = name
        counts.set(key, cur)
      }
    }
    const out = [...counts.values()].map((x) => ({ ...x, monthKey: r.monthKey }))
    out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.email.localeCompare(b.email))
    return out.filter((x) => x.count >= 3)
  }, [rangeQ.data, accessiRangeQ.data, giorno])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`fitcenter-corsi-appello:${giorno}`)
      if (!raw) return setAppello({})
      const parsed = JSON.parse(raw) as Record<string, true>
      setAppello(parsed && typeof parsed === "object" ? parsed : {})
    } catch {
      setAppello({})
    }
  }, [giorno])

  function isAppelloChecked(groupKey: string, p: PrenotazioneCorsoRow, idx: number): boolean {
    const k = `${groupKey}::${participantStableKey(p, idx)}`
    if (appello[k]) return true
    // Compatibilità: chiavi salvate con versione precedente (include idx sempre).
    const old = `${groupKey}::${legacyParticipantKey(p, idx)}`
    return !!appello[old]
  }

  function toggleAppello(groupKey: string, p: PrenotazioneCorsoRow, idx: number): void {
    const k = `${groupKey}::${participantStableKey(p, idx)}`
    const old = `${groupKey}::${legacyParticipantKey(p, idx)}`
    setAppello((prev) => {
      const next = { ...prev }
      const has = !!next[k] || !!next[old]
      if (has) {
        delete next[k]
        delete next[old]
      } else {
        next[k] = true
        next[old] = true
      }
      try {
        localStorage.setItem(`fitcenter-corsi-appello:${giorno}`, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  function openMessaggi(g: CorsoGroup) {
    if (!canSendMessages) return
    setMessaggiGroup(g)
    const ne = uniqueValidEmails(g.partecipanti).length
    setMessaggiChannel(ne > 0 ? "email" : "whatsapp")
    setMessaggiSubject(`Lezione: ${g.servizio}`)
    setMessaggiBody(defaultMessageBody(g))
    setWaCursor(0)
  }

  if (!enabled) {
    return (
      <div className="p-6 text-red-400">
        Permessi insufficienti.
      </div>
    )
  }

  const modalEmails = messaggiGroup ? uniqueValidEmails(messaggiGroup.partecipanti) : []
  const modalWaLinks = messaggiGroup ? waLinksForGroup(messaggiGroup, messaggiBody) : []
  const canOpenNext = modalWaLinks.length > 0 && waCursor >= 0 && waCursor < modalWaLinks.length

  function openWaAt(i: number): void {
    const href = modalWaLinks[i]?.href
    if (!href) return
    window.open(href, "_blank", "noreferrer")
  }

  function openWaNext(): void {
    if (!canOpenNext) return
    openWaAt(waCursor)
    setWaCursor((x) => Math.min(modalWaLinks.length, x + 1))
  }

  async function openWaAll(): Promise<void> {
    if (modalWaLinks.length === 0) return
    for (let i = 0; i < modalWaLinks.length; i += 1) {
      openWaAt(i)
      // piccola pausa per ridurre blocchi popup
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 350))
    }
    setWaCursor(modalWaLinks.length)
  }

  return (
    <div className="p-4 sm:p-6">
      {canManageNoShow ? (
        <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-100">No-show (mese)</div>
              <div className="mt-0.5 text-xs text-zinc-500">
                Regola: conta prenotazioni senza accessi (AccessiDataOra) dentro la finestra lezione (DataInizio/FinePrenotazioneIscrizione) né appello. Soglia: 3 nel mese.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void Promise.all([rangeQ.refetch(), accessiRangeQ.refetch()])}
              disabled={rangeQ.isFetching}
              className="rounded-lg border border-zinc-700 bg-zinc-950/30 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800/30 disabled:opacity-50"
            >
              {rangeQ.isFetching ? "Analisi…" : "Analizza mese"}
            </button>
          </div>
          {rangeQ.isError || accessiRangeQ.isError ? (
            <p className="mt-2 text-sm text-red-400">
              Errore analisi: {String(((rangeQ.error as Error) ?? (accessiRangeQ.error as Error))?.message ?? "Errore")}
            </p>
          ) : null}
          {!rangeQ.data ? null : noShowCandidates.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nessun cliente con 3+ no-show nel mese selezionato.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/40">
                    <th className="px-3 py-2 text-xs font-medium text-zinc-400">Email</th>
                    <th className="px-3 py-2 text-xs font-medium text-zinc-400">No-show</th>
                    <th className="px-3 py-2 text-xs font-medium text-zinc-400">Azione</th>
                  </tr>
                </thead>
                <tbody>
                  {noShowCandidates.map((x) => {
                    const isBlocked = blockedByEmail.has(x.email)
                    return (
                      <tr key={x.email} className="border-b border-zinc-800/50 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-zinc-200">{x.email}</td>
                        <td className="px-3 py-2 text-zinc-200">{x.count}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            disabled={notifyBlockMutation.isPending || isBlocked}
                            onClick={() => notifyBlockMutation.mutate({ email: x.email, monthKey: x.monthKey, count: x.count })}
                            className="rounded-lg border border-amber-700/60 bg-amber-950/20 px-3 py-2 text-xs font-medium text-amber-200 disabled:opacity-50"
                            title={isBlocked ? "Già bloccato" : "Invia email e marca come bloccato"}
                          >
                            {isBlocked ? "Bloccato" : notifyBlockMutation.isPending ? "Invio…" : "Invia mail + blocca"}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      {messaggiGroup ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="messaggi-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMessaggiGroup(null)
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="messaggi-dialog-title" className="text-lg font-semibold text-zinc-100">
              Messaggi
            </h2>
            <p className="mt-1 text-sm text-zinc-300">{messaggiGroup.servizio}</p>
            <p className="text-xs text-zinc-500">
              {fmtDateIt(messaggiGroup.giorno)}
              {messaggiGroup.oraInizio ? ` · ${fmtTimeDot(messaggiGroup.oraInizio)}` : ""}
              {messaggiGroup.oraFine ? `–${fmtTimeDot(messaggiGroup.oraFine)}` : ""}
            </p>

            <div className="mt-4 flex rounded-lg border border-zinc-700 p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  messaggiChannel === "email"
                    ? "bg-amber-600/90 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => setMessaggiChannel("email")}
              >
                Email
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  messaggiChannel === "whatsapp"
                    ? "bg-emerald-700/90 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => setMessaggiChannel("whatsapp")}
              >
                WhatsApp
              </button>
            </div>

            {messaggiChannel === "email" ? (
              <label className="mt-4 grid gap-1 text-sm text-zinc-400">
                <span>Oggetto</span>
                <input
                  value={messaggiSubject}
                  onChange={(e) => setMessaggiSubject(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-zinc-100"
                />
              </label>
            ) : null}

            <label className="mt-4 grid gap-1 text-sm text-zinc-400">
              <span>Messaggio</span>
              <textarea
                value={messaggiBody}
                onChange={(e) => setMessaggiBody(e.target.value)}
                rows={8}
                className="resize-y rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-100"
              />
            </label>

            {messaggiChannel === "email" ? (
              <p className="mt-2 text-xs text-zinc-500">
                Destinatari email:{" "}
                <span className="font-medium text-zinc-300">{modalEmails.length}</span>
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-zinc-500">
                  Apri WhatsApp sul telefono e invia il messaggio a ciascun contatto (numero da colonna SMS).
                </p>
                {modalWaLinks.length === 0 ? (
                  <p className="rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-500">
                    Nessun numero cellulare disponibile per questo corso.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
                      <div className="text-xs text-zinc-400">
                        Contatti: <span className="font-medium text-zinc-200">{modalWaLinks.length}</span>
                        {" · "}
                        Prossimo:{" "}
                        <span className="font-medium text-emerald-300">{Math.min(waCursor + 1, modalWaLinks.length)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openWaNext()}
                          disabled={!canOpenNext}
                          className="touch-manipulation rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
                        >
                          Apri prossimo
                        </button>
                        <button
                          type="button"
                          onClick={() => void openWaAll()}
                          className="touch-manipulation rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800/60"
                        >
                          Apri tutti
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                    {modalWaLinks.map((w) => (
                      <a
                        key={w.href}
                        href={w.href}
                        target="_blank"
                        rel="noreferrer"
                        className="touch-manipulation inline-flex min-h-[44px] items-center justify-center rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-900/40"
                      >
                        Apri WhatsApp · {w.label}
                      </a>
                    ))}
                  </div>
                  </div>
                )}
              </div>
            )}

            {messaggiChannel === "email" && notifyMutation.isError ? (
              <p className="mt-2 text-sm text-red-400">{(notifyMutation.error as Error).message}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
              <button
                type="button"
                className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                onClick={() => setMessaggiGroup(null)}
              >
                Chiudi
              </button>
              {messaggiChannel === "email" ? (
                <button
                  type="button"
                  disabled={
                    notifyMutation.isPending ||
                    !messaggiSubject.trim() ||
                    !messaggiBody.trim() ||
                    modalEmails.length === 0
                  }
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-500 disabled:opacity-40"
                  onClick={() => notifyMutation.mutate()}
                >
                  {notifyMutation.isPending ? "Invio…" : "Invia email"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Corsi</h1>
          <p className="mt-1 text-sm text-zinc-400">Elenco corsi del giorno con partecipanti.</p>
        </div>
        <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 sm:items-end">
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>Giorno</span>
            <input
              type="date"
              value={giorno}
              onChange={(e) => setGiorno(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100 shadow-sm focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            />
          </label>
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>Cerca corso</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Es. pilates"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100 shadow-sm placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30 sm:w-56"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/40 to-zinc-950/20 p-5 shadow-lg">
        {isLoading ? (
          <p className="text-sm text-zinc-500">Caricamento...</p>
        ) : error ? (
          <p className="text-sm text-red-400">Errore: {(error as Error).message}</p>
        ) : gruppi.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">Nessuna prenotazione per il giorno selezionato.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-zinc-400">
                Totale partecipanti: <span className="font-semibold text-amber-400">{totalePartecipanti}</span>
              </div>
              <div className="text-xs text-zinc-500">
                Corsi: <span className="font-medium text-zinc-300">{gruppiFiltrati.length}</span>
                {search.trim() ? (
                  <span className="text-zinc-600"> (filtrati)</span>
                ) : null}
              </div>
            </div>

            {gruppiFiltrati.map((g) => {
              const canMessaggi =
                canSendMessages && (uniqueValidEmails(g.partecipanti).length > 0 || hasWhatsAppableContacts(g))
              return (
                <div key={g.key} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold tracking-tight text-zinc-100">
                        {g.servizio}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        gio {fmtDateIt(g.giorno)}
                        {g.oraInizio ? ` · ${fmtTimeDot(g.oraInizio)}` : ""}
                        {g.oraFine ? `–${fmtTimeDot(g.oraFine)}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-300">
                        {g.partecipanti.length} partecipanti
                      </div>
                      <button
                        type="button"
                        className="touch-manipulation rounded-lg border border-zinc-600 bg-zinc-800/60 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!canMessaggi}
                        title={
                          canMessaggi
                            ? "Invia messaggio ai prenotati (email o WhatsApp)"
                            : canSendMessages
                              ? "Nessun indirizzo email né numero cellulare per questo corso"
                              : "Solo lettura: non puoi inviare messaggi"
                        }
                        onClick={() => openMessaggi(g)}
                      >
                        Messaggi
                      </button>
                    </div>
                  </div>

                  <div className="block sm:hidden">
                    <div className="divide-y divide-zinc-800/60">
                      {g.partecipanti.map((p, idx) => {
                        const prog = (p.raw as any)?.Progressivo ?? (p.raw as any)?.progressivo ?? (idx + 1)
                        const nome = `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || "—"
                        const blocked = blockedByEmail.has((p.email ?? "").trim().toLowerCase())
                        const pren = p.prenotatoIl
                          ? new Date(p.prenotatoIl).toLocaleString("it-IT", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""
                        const note = (p.note ?? "").trim()
                        const access = isPresentByAccess(accessIdxDay, p, giorno)
                        const okAccesso = access.present
                        const okAppello = isAppelloChecked(g.key, p, idx)
                        const presente = okAccesso || okAppello
                        const accessoInfo = access.entry
                          ? { timeLabel: `${String(access.entry.getHours()).padStart(2, "0")}:${String(access.entry.getMinutes()).padStart(2, "0")}`, minutes: access.entry.getHours() * 60 + access.entry.getMinutes() }
                          : { timeLabel: null, minutes: null }
                        const uscitaAnt = possibileUscitaAnticipata({ ...g, giorno }, p)
                        const nCorsiOggi = prenotazioniPerPartecipante.get(participantStableKey(p, idx)) ?? 0
                        return (
                          <div key={idx} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-zinc-100">
                                  {String(prog)}. {nome}
                                  {p.inAttesa ? (
                                    <span className="ml-2 inline-flex items-center rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                                      ATTESA
                                    </span>
                                  ) : null}
                                  {blocked ? (
                                    <span className="ml-2 inline-flex items-center rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                                      BLOCCATO
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 text-xs text-zinc-400">
                                  Prenotato: <span className="text-zinc-300">{pren || "—"}</span>
                                </div>
                                {accessoInfo.timeLabel || uscitaAnt || nCorsiOggi > 1 ? (
                                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] leading-tight">
                                    {accessoInfo.timeLabel ? (
                                      <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-sky-200">
                                        Ultimo accesso {accessoInfo.timeLabel}
                                      </span>
                                    ) : null}
                                    {uscitaAnt ? (
                                      <span
                                        className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-amber-200"
                                        title="Passaggio in palestra prima della fine della lezione: possibile uscita anticipata o altro corso dopo."
                                      >
                                        Possibile uscita anticipata
                                      </span>
                                    ) : null}
                                    {nCorsiOggi > 1 ? (
                                      <span className="rounded border border-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 text-zinc-400">
                                        {nCorsiOggi} corsi oggi
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  type="button"
                                  title={
                                    okAccesso
                                      ? "Presente (accesso effettuato oggi)"
                                      : presente
                                        ? "Presente (appello)"
                                        : "Segna presente (appello)"
                                  }
                                  aria-pressed={presente}
                                  disabled={okAccesso}
                                  onClick={() => toggleAppello(g.key, p, idx)}
                                  className={`touch-manipulation h-5 w-5 rounded border transition-colors ${
                                    presente
                                      ? "border-emerald-400/60 bg-emerald-500/30"
                                      : "border-zinc-600 bg-zinc-900/40 hover:bg-zinc-800/50"
                                  } ${okAccesso ? "cursor-not-allowed opacity-90" : ""}`}
                                />
                              </div>
                            </div>
                            {note ? (
                              <div className="mt-2 text-xs text-zinc-300">
                                <span className="text-zinc-500">Note: </span>
                                {note}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="hidden overflow-x-auto sm:block">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-950/40">
                          <th className="px-5 py-3 font-medium text-zinc-400">#</th>
                          <th className="px-5 py-3 font-medium text-zinc-400">Presente</th>
                          <th className="px-5 py-3 font-medium text-zinc-400">Accesso / uscita</th>
                          <th className="px-5 py-3 font-medium text-zinc-400">Cognome e Nome</th>
                          <th className="px-5 py-3 font-medium text-zinc-400">Prenotato il</th>
                          <th className="px-5 py-3 font-medium text-zinc-400">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.partecipanti.map((p, idx) => {
                          const prog = (p.raw as any)?.Progressivo ?? (p.raw as any)?.progressivo ?? (idx + 1)
                          const nome = `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || "—"
                          const blocked = blockedByEmail.has((p.email ?? "").trim().toLowerCase())
                          const pren = p.prenotatoIl
                            ? new Date(p.prenotatoIl).toLocaleString("it-IT", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : ""
                          const access = isPresentByAccess(accessIdxDay, p, giorno)
                          const okAccesso = access.present
                          const okAppello = isAppelloChecked(g.key, p, idx)
                          const presente = okAccesso || okAppello
                          const accessoInfo = access.entry
                            ? { timeLabel: `${String(access.entry.getHours()).padStart(2, "0")}:${String(access.entry.getMinutes()).padStart(2, "0")}`, minutes: access.entry.getHours() * 60 + access.entry.getMinutes() }
                            : { timeLabel: null, minutes: null }
                          const uscitaAnt = possibileUscitaAnticipata({ ...g, giorno }, p)
                          const nCorsiOggi = prenotazioniPerPartecipante.get(participantStableKey(p, idx)) ?? 0
                          return (
                            <tr key={idx} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20">
                              <td className="px-5 py-3 text-zinc-300">{String(prog)}</td>
                              <td className="px-5 py-3">
                                <button
                                  type="button"
                                  title={
                                    okAccesso
                                      ? "Presente (accesso effettuato oggi)"
                                      : presente
                                        ? "Presente (appello)"
                                        : "Segna presente (appello)"
                                  }
                                  aria-pressed={presente}
                                  disabled={okAccesso}
                                  onClick={() => toggleAppello(g.key, p, idx)}
                                  className={`touch-manipulation h-5 w-5 rounded border transition-colors ${
                                    presente
                                      ? "border-emerald-400/60 bg-emerald-500/30"
                                      : "border-zinc-600 bg-zinc-900/40 hover:bg-zinc-800/50"
                                  } ${okAccesso ? "cursor-not-allowed opacity-90" : ""}`}
                                />
                              </td>
                              <td className="max-w-[11rem] px-5 py-3 align-top text-xs text-zinc-400">
                                <div className="flex flex-col gap-1">
                                  {accessoInfo.timeLabel ? (
                                    <span className="text-sky-200/95">{accessoInfo.timeLabel}</span>
                                  ) : (
                                    <span className="text-zinc-600">—</span>
                                  )}
                                  {uscitaAnt ? (
                                    <span
                                      className="inline-flex w-fit rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200"
                                      title="Passaggio prima della fine lezione: possibile uscita anticipata o altro corso dopo."
                                    >
                                      Uscita anticipata?
                                    </span>
                                  ) : null}
                                  {nCorsiOggi > 1 ? (
                                    <span className="text-[10px] text-zinc-500">{nCorsiOggi} corsi oggi</span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-5 py-3 font-medium text-zinc-100">
                                {nome}
                                {p.inAttesa ? (
                                  <span className="ml-2 inline-flex items-center rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                                    ATTESA
                                  </span>
                                ) : null}
                                {blocked ? (
                                  <span className="ml-2 inline-flex items-center rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                                    BLOCCATO
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-5 py-3 text-zinc-300">{pren || "—"}</td>
                              <td className="px-5 py-3 text-zinc-300">{p.note ?? ""}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
