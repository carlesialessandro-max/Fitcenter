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

function bestOraFromRaw(raw: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = raw?.[k]
    if (v == null) continue
    const dt = parseDateAny(v)
    if (!dt) continue
    const hh = String(dt.getHours()).padStart(2, "0")
    const mm = String(dt.getMinutes()).padStart(2, "0")
    const out = `${hh}:${mm}`
    if (out !== "00:00") return out
  }
  return undefined
}

function groupByCorso(rows: PrenotazioneCorsoRow[]): CorsoGroup[] {
  const map = new Map<string, CorsoGroup>()
  const byBase = new Map<string, CorsoGroup[]>() // servizio+giorno(+id) -> gruppi (per agganciare attese senza orario)
  const byServiceDay = new Map<string, CorsoGroup[]>() // servizio+giorno -> gruppi (per agganciare attese per orario)
  const waitBuckets = new Map<string, CorsoGroup>() // servizio+giorno -> gruppo "attesa" separato
  for (const r of rows) {
    const servizio = getCorsoTitolo(r)
    const giorno = (r.giorno ?? "").trim() || "—"
    const raw = (r.raw ?? {}) as any
    const corsoId =
      firstNonEmptyStr(raw?.IDAppuntamento) ??
      firstNonEmptyStr(raw?.AppuntamentoId) ??
      firstNonEmptyStr(raw?.IDLezione) ??
      firstNonEmptyStr(raw?.LezioneId) ??
      firstNonEmptyStr(raw?.IDCorso) ??
      firstNonEmptyStr(raw?.CorsoId) ??
      firstNonEmptyStr(raw?.IDSchedaCorso)
    // Alcune viste tornano oraInizio/oraFine come "00:00" anche se la datetime ha l'orario corretto:
    // proviamo a derivarlo dalle colonne datetime raw.
    const oraInizio =
      ((r.oraInizio ?? "").trim() && (r.oraInizio ?? "").trim() !== "00:00" ? (r.oraInizio ?? "").trim() : undefined) ??
      bestOraFromRaw(raw, [
        "DataInizioPrenotazioneIscrizione",
        "InizioPrenotazioneIscrizione",
        "DataOraInizio",
        "DataInizio",
        "Inizio",
        // Lista attesa: spesso qui c'è l'orario vero
        "PrenotazioniListaAttesaDataInizio",
        // Alcuni gestionali mettono l'ora in una "data fittizia" (es. 1899-12-30 14:30) in DalleOre
        "DalleOre",
      ]) ??
      ((r.oraInizio ?? "").trim() ? (r.oraInizio ?? "").trim() : undefined)
    const oraFine =
      ((r.oraFine ?? "").trim() && (r.oraFine ?? "").trim() !== "00:00" ? (r.oraFine ?? "").trim() : undefined) ??
      bestOraFromRaw(raw, ["DataFinePrenotazioneIscrizione", "DataOraFine", "DataFine", "Fine"]) ??
      ((r.oraFine ?? "").trim() ? (r.oraFine ?? "").trim() : undefined)
    const isWait = !!r.inAttesa
    const waitNoTime = isWait && (!oraInizio || oraInizio === "00:00")

    // Se è in attesa ma abbiamo un'ora (es. da DalleOre) e manca l'oraFine,
    // proviamo ad agganciarla al corso del giorno con stessa oraInizio.
    if (isWait && !waitNoTime && oraInizio && (!oraFine || oraFine === "00:00")) {
      const pool = byServiceDay.get(`${servizio}__${giorno}`) ?? []
      if (pool.length > 0) {
        const exact = pool.find((g) => (g.oraInizio ?? "") === oraInizio && !g.key.includes("__WAITLIST"))
        if (exact) {
          exact.partecipanti.push(r)
          continue
        }
        // fallback: più vicino per ora
        const toMin = (t?: string) => {
          if (!t || !/^\d{2}:\d{2}$/.test(t)) return null
          const [h, m] = t.split(":").map((x) => Number(x))
          return h * 60 + m
        }
        const target = toMin(oraInizio)
        if (target != null) {
          const scored = pool
            .filter((g) => !g.key.includes("__WAITLIST"))
            .map((g) => ({ g, m: toMin(g.oraInizio) }))
            .filter((x) => x.m != null) as { g: CorsoGroup; m: number }[]
          if (scored.length > 0) {
            scored.sort((a, b) => Math.abs(a.m - target) - Math.abs(b.m - target) || a.m - b.m)
            scored[0]!.g.partecipanti.push(r)
            continue
          }
        }
      }
    }

    // Se è in attesa e non ha un orario affidabile:
    // - se abbiamo un id corso/appuntamento, agganciamo comunque al corso giusto
    // - altrimenti proviamo ad agganciare per orario (es. due corsi stesso servizio: 08:45 e 14:30)
    // - altrimenti la mettiamo in un bucket separato (evita mescolare 08:45 con 14:30).
    if (waitNoTime) {
      if (corsoId) {
        const baseKey = `${servizio}__${giorno}__${corsoId}`
        const candidates = byBase.get(baseKey) ?? []
        if (candidates.length > 0) {
          const pick = [...candidates].sort((a, b) => (a.oraInizio ?? "").localeCompare(b.oraInizio ?? ""))[0]!
          pick.partecipanti.push(r)
          continue
        }
      }

      // Aggancio per orario: usa la datetime di lista attesa / DalleOre se presente.
      const waitDt =
        parseDateAny(raw?.DalleOre) ??
        parseDateAny(raw?.PrenotazioniListaAttesaDataInizio) ??
        parseDateAny(raw?.DataInizioPrenotazioneIscrizione) ??
        parseDateAny(raw?.InizioPrenotazioneIscrizione) ??
        null
      const waitHHmm =
        waitDt != null
          ? `${String(waitDt.getHours()).padStart(2, "0")}:${String(waitDt.getMinutes()).padStart(2, "0")}`
          : oraInizio
      if (waitHHmm && /^\d{2}:\d{2}$/.test(waitHHmm)) {
        const pool = byServiceDay.get(`${servizio}__${giorno}`) ?? []
        if (pool.length > 0) {
          const toMin = (t?: string) => {
            if (!t || !/^\d{2}:\d{2}$/.test(t)) return null
            const [h, m] = t.split(":").map((x) => Number(x))
            return h * 60 + m
          }
          const target = toMin(waitHHmm)
          if (target != null) {
            const scored = pool
              .map((g) => ({ g, m: toMin(g.oraInizio) }))
              .filter((x) => x.m != null) as { g: CorsoGroup; m: number }[]
            if (scored.length > 0) {
              scored.sort((a, b) => Math.abs(a.m - target) - Math.abs(b.m - target) || a.m - b.m)
              scored[0]!.g.partecipanti.push(r)
              continue
            }
          }
        }
      }

      const wbKey = `${servizio}__${giorno}__WAITLIST`
      const wb = waitBuckets.get(wbKey) ?? { key: wbKey, servizio, giorno, oraInizio: undefined, oraFine: undefined, partecipanti: [] }
      wb.partecipanti.push(r)
      waitBuckets.set(wbKey, wb)
      continue
    }

    const key = `${servizio}__${giorno}__${corsoId ?? ""}__${oraInizio ?? ""}__${oraFine ?? ""}`
    const g = map.get(key)
    if (!g) {
      const created = { key, servizio, giorno, oraInizio, oraFine, partecipanti: [r] }
      map.set(key, created)
      const baseKey = `${servizio}__${giorno}__${corsoId ?? ""}`
      byBase.set(baseKey, [...(byBase.get(baseKey) ?? []), created])
      const sd = `${servizio}__${giorno}`
      byServiceDay.set(sd, [...(byServiceDay.get(sd) ?? []), created])
    } else {
      g.partecipanti.push(r)
    }
  }
  const list = [...Array.from(map.values()), ...Array.from(waitBuckets.values())]
  list.sort((a, b) => {
    const aw = a.key.includes("__WAITLIST") ? 1 : 0
    const bw = b.key.includes("__WAITLIST") ? 1 : 0
    if (aw !== bw) return aw - bw // WAITLIST in fondo
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
  // Priorità: ID già normalizzato dalla API (evita mismatch/collisioni su viste diverse).
  const idFromRow = firstNonEmptyStr((p as any)?.idUtente)
  const id =
    idFromRow ??
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
  // Supporta formato SQL: YYYY-MM-DD HH:mm:ss(.ms) oppure YYYY-MM-DD HH.mm.ss(.ms)
  const sql = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2})[:\.](\d{2})(?:[:\.](\d{2}))?(?:\.(\d{1,3}))?$/.exec(sNorm)
  if (sql) {
    const yyyy = Number(sql[1])
    const mm = Number(sql[2])
    const dd = Number(sql[3])
    const hh = Number(sql[4] ?? 0)
    const mi = Number(sql[5] ?? 0)
    const ss = Number(sql[6] ?? 0)
    const ms = Number((sql[7] ?? "0").padEnd(3, "0"))
    const d = new Date(yyyy, mm - 1, dd, hh, mi, ss, ms)
    return Number.isNaN(d.getTime()) ? null : d
  }

  // Gestionali/driver a volte serializzano orari locali aggiungendo "Z" (UTC) erroneamente.
  // Se vediamo ISO con Z, reinterpretalo come locale (non UTC) per allineare con gli orari lezione.
  const isoZ = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(?:Z|[+-]\d{2}:?\d{2})$/.exec(sNorm)
  if (isoZ) {
    const yyyy = Number(isoZ[1])
    const mm = Number(isoZ[2])
    const dd = Number(isoZ[3])
    const hh = Number(isoZ[4] ?? 0)
    const mi = Number(isoZ[5] ?? 0)
    const ss = Number(isoZ[6] ?? 0)
    const frac = String(isoZ[7] ?? "0")
    const ms = Number(frac.slice(0, 3).padEnd(3, "0"))
    const d = new Date(yyyy, mm - 1, dd, hh, mi, ss, ms)
    return Number.isNaN(d.getTime()) ? null : d
  }

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

function isoDayUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function localYmd(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${mo}-${day}`
}

function makeLocalDateFromYmd(ymd: string, hh: number, mm: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  const dt = new Date(y, mo - 1, d, hh, mm, 0, 0)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function getLessonWindow(p: PrenotazioneCorsoRow, fallbackDayIso?: string): { start: Date | null; end: Date | null } {
  const raw = (p.raw ?? {}) as any
  let start =
    parseDateAny(raw?.DataInizioPrenotazioneIscrizione) ??
    parseDateAny(raw?.InizioPrenotazioneIscrizione) ??
    parseDateAny(raw?.DataInizio) ??
    null
  let end =
    parseDateAny(raw?.DataFinePrenotazioneIscrizione) ??
    parseDateAny(raw?.DataFine) ??
    null

  const oi = (p.oraInizio ?? "").trim()
  const of = (p.oraFine ?? "").trim()
  const dayIso = String((p.giorno ?? "").trim() || fallbackDayIso || "").trim()

  // PRIORITÀ: se abbiamo (giorno ISO + oraInizio/oraFine) affidabili, usali sempre.
  // Nel gestionale alcune viste mettono InizioPrenotazioneIscrizione a 00:00:00 e "sporcono" lo start.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayIso) && /^\d{1,2}:\d{2}$/.test(oi) && oi !== "00:00") {
    const [hh, mm] = oi.split(":").map((x) => Number(x))
    const d = makeLocalDateFromYmd(dayIso, hh, mm)
    if (d) start = d
  }
  if (start && /^\d{1,2}:\d{2}$/.test(of) && of !== "00:00") {
    const [hh, mm] = of.split(":").map((x) => Number(x))
    const d = new Date(start)
    d.setHours(hh, mm, 0, 0)
    if (!Number.isNaN(d.getTime())) end = d
  }

  // Alcune viste espongono Inizio/Fine con data corretta ma ORA = 00:00:00.
  // In questo caso, se abbiamo oraInizio/oraFine, correggiamo l'orario.
  if (start && start.getHours() === 0 && start.getMinutes() === 0 && /^\d{1,2}:\d{2}$/.test(oi)) {
    const [hh, mm] = oi.split(":").map((x) => Number(x))
    const d = new Date(start)
    d.setHours(hh, mm, 0, 0)
    if (!Number.isNaN(d.getTime())) start = d
  }
  if (end && end.getHours() === 0 && end.getMinutes() === 0 && /^\d{1,2}:\d{2}$/.test(of)) {
    const [hh, mm] = of.split(":").map((x) => Number(x))
    const d = new Date(end)
    d.setHours(hh, mm, 0, 0)
    if (!Number.isNaN(d.getTime())) end = d
  }

  // Fallback: alcune viste non espongono le colonne DataInizio/FinePrenotazioneIscrizione.
  // In quel caso ricostruiamo dalla coppia (giorno + oraInizio/oraFine) della prenotazione.
  if (!start) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayIso) && /^\d{1,2}:\d{2}$/.test(oi)) {
      const [hh, mm] = oi.split(":").map((x) => Number(x))
      const d = makeLocalDateFromYmd(dayIso, hh, mm)
      if (d) start = d
    }
  }
  if (!end && start) {
    if (/^\d{1,2}:\d{2}$/.test(of)) {
      const [hh, mm] = of.split(":").map((x) => Number(x))
      const d = new Date(start)
      d.setHours(hh, mm, 0, 0)
      if (!Number.isNaN(d.getTime())) end = d
    }
  }
  return { start, end }
}

type AccessEvent = { t: Date; kind: "in" | "out" }
type AccessIndex = Map<string, AccessEvent[]> // idKey -> access events (sorted by time)

function accessKeyEmailFromRaw(raw: any): string | null {
  const cand = String(raw?.Email ?? raw?.email ?? raw?.CustomerEmail ?? raw?.customerEmail ?? "").trim().toLowerCase()
  if (!cand || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cand)) return null
  return `email:${cand}`
}

function accessKeyNameFromAny(input: { cognome?: unknown; nome?: unknown; raw?: any }): string | null {
  const cognome = String(input.cognome ?? input.raw?.Cognome ?? input.raw?.cognome ?? "").trim().toLowerCase()
  const nome = String(input.nome ?? input.raw?.Nome ?? input.raw?.nome ?? "").trim().toLowerCase()
  const full = `${cognome}|${nome}`.replace(/\s+/g, " ").trim()
  if (!full || full === "|") return null
  return `name:${full}`
}

function accessKindFromRaw(raw: any): AccessEvent["kind"] {
  const blob = [
    raw?.TerminaleDescrizione,
    raw?.TerminaleDesc,
    raw?.terminaleDescrizione,
    raw?.DescrizioneTerminale,
    raw?.Terminale,
    raw?.terminale,
    raw?.Varco,
    raw?.varco,
    raw?.VarcoDescrizione,
    raw?.Descrizione,
    raw?.descrizione,
    raw?.Note,
    raw?.note,
  ]
    .map((x) => String(x ?? ""))
    .join(" ")
    .toLowerCase()

  // Regole:
  // - se troviamo "uscita"/"exit" => out
  // - altrimenti se troviamo "ingresso"/"entrata"/"in" => in
  // - fallback: in
  if (/\buscit[aeio]?\b|\bexit\b/.test(blob)) return "out"
  if (/\bingress[oa]\b|\bentrata\b|\bin\b/.test(blob)) return "in"
  return "in"
}

function parseAccessDateAny(val: unknown): Date | null {
  if (val == null) return null
  // Per gli accessi vogliamo interpretare gli ISO con Z/offset come ORARI LOCALI (il gestionale li serializza così).
  const s = String(val).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(?:Z|[+-]\d{2}:?\d{2})$/.exec(s)
  if (m) {
    const yyyy = Number(m[1])
    const mm = Number(m[2])
    const dd = Number(m[3])
    const hh = Number(m[4] ?? 0)
    const mi = Number(m[5] ?? 0)
    const ss = Number(m[6] ?? 0)
    const frac = String(m[7] ?? "0")
    const ms = Number(frac.slice(0, 3).padEnd(3, "0"))
    const d = new Date(yyyy, mm - 1, dd, hh, mi, ss, ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return parseDateAny(val)
}

function buildAccessIndexForDay(rows: AccessoUtenteRow[], giornoIso: string): AccessIndex {
  const m = new Map<string, AccessEvent[]>()
  const push = (k: string, ev: AccessEvent) => {
    const list = m.get(k) ?? []
    list.push(ev)
    m.set(k, list)
  }
  for (const r of rows) {
    const raw = (r.raw ?? {}) as any
    const id = String(r.idUtente ?? raw?.IDUtente ?? raw?.IdUtente ?? raw?.UtenteId ?? "").trim()
    const k = `id:${id}`
    const kEmail = accessKeyEmailFromRaw(raw)
    const kName = accessKeyNameFromAny({ cognome: r.cognome, nome: r.nome, raw })

    const dtIn = parseAccessDateAny(raw?.AccessiDataOra ?? r.dataEntrata ?? raw?.AccessiData ?? raw?.AccessiOra)
    if (dtIn && localYmd(dtIn) === giornoIso) {
      // Alcune viste esportano "uscita" come riga separata con timestamp in AccessiDataOra (non in dataUscita).
      const kind = accessKindFromRaw(raw)
      const ev: AccessEvent = { t: dtIn, kind }
      if (id) push(k, ev)
      if (kEmail) push(kEmail, ev)
      if (kName) push(kName, ev)
    }

    const dtOut = parseAccessDateAny(r.dataUscita ?? raw?.Uscita ?? raw?.DataUscita ?? raw?.DataOraUscita ?? raw?.UscitaOra)
    if (dtOut && localYmd(dtOut) === giornoIso) {
      const ev: AccessEvent = { t: dtOut, kind: "out" }
      if (id) push(k, ev)
      if (kEmail) push(kEmail, ev)
      if (kName) push(kName, ev)
    }
  }
  for (const [k, list] of m.entries()) {
    list.sort((a, b) => a.t.getTime() - b.t.getTime())
    m.set(k, list)
  }
  return m
}

function isPresentByAccess(accessIdx: AccessIndex, p: PrenotazioneCorsoRow, giornoIso: string): { present: boolean; entry: Date | null; exit: Date | null } {
  const stable = participantStableKey(p, 0)
  const candidateKeys: string[] = []
  if (stable.startsWith("id:")) candidateKeys.push(stable)
  const raw = (p.raw ?? {}) as any
  const emailKey = accessKeyEmailFromRaw(raw) ?? (() => {
    const e = String(p.email ?? "").trim().toLowerCase()
    return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? `email:${e}` : null
  })()
  if (emailKey) candidateKeys.push(emailKey)
  const nameKey = accessKeyNameFromAny({ cognome: p.cognome, nome: p.nome, raw })
  if (nameKey) candidateKeys.push(nameKey)

  let evs: AccessEvent[] = []
  for (const k of candidateKeys) {
    const got = accessIdx.get(k)
    if (got && got.length > 0) {
      evs = got
      break
    }
  }
  if (evs.length === 0) return { present: false, entry: null, exit: null }

  const ins = evs.filter((e) => e.kind === "in").map((e) => e.t)
  const outs = evs.filter((e) => e.kind === "out").map((e) => e.t)
  if (ins.length === 0) return { present: false, entry: null, exit: null }

  const firstIn = ins[0] ?? null
  const lastOut = outs.length > 0 ? outs[outs.length - 1] : null

  const w = getLessonWindow(p, giornoIso)
  // Se non abbiamo orario lezione, applichiamo regola semplice: entrata nel giorno => presente.
  if (!w.start) return { present: true, entry: firstIn, exit: lastOut }
  // Day guard
  if (localYmd(w.start) !== giornoIso) return { present: false, entry: null, exit: null }

  // Regola presenza (robusta a ingressi molto prima del corso e a ingressi multipli):
  // - consideriamo l'ultimo evento entro la fine lezione (+ tolleranza)
  // - se l'ultimo evento è "in" => presente, se è "out" => assente
  const endMs = (w.end ?? w.start).getTime()
  const graceAfterMs = 60 * 60 * 1000
  const cutoffMs = endMs + graceAfterMs

  let lastEv: AccessEvent | null = null
  let lastIn: Date | null = null
  let lastOutInRange: Date | null = null
  for (const e of evs) {
    const ms = e.t.getTime()
    if (ms > cutoffMs) break
    lastEv = e
    if (e.kind === "in") lastIn = e.t
    if (e.kind === "out") lastOutInRange = e.t
  }
  if (!lastEv) return { present: false, entry: null, exit: null }
  const present = lastEv.kind === "in"
  return { present, entry: present ? (lastIn ?? firstIn) : null, exit: present ? lastOutInRange : null }
}

/** Se l’ultimo passaggio è prima dell’orario di fine lezione, può essere un’uscita anticipata (euristica). */
function possibileUscitaAnticipata(g: CorsoGroup, p: PrenotazioneCorsoRow, accessIdx: AccessIndex): boolean {
  // Mostra solo quando vediamo una vera "uscita" prima della fine lezione.
  const stable = participantStableKey(p, 0)
  if (!stable.startsWith("id:")) return false
  const evs = accessIdx.get(stable) ?? []
  if (evs.length === 0) return false

  const w = getLessonWindow(p, g.giorno)
  if (!w.start || !w.end) return false
  const startMs = w.start.getTime()
  const endMs = w.end.getTime()

  // Cerca una uscita (out) dopo l'inizio e prima della fine.
  return evs.some((e) => e.kind === "out" && e.t.getTime() >= startMs && e.t.getTime() < endMs)
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
  const [courseNotes, setCourseNotes] = useState<Record<string, string>>({})

  const enabled = role === "admin" || role === "corsi" || role === "istruttore"
  const canSendMessages = role === "admin" || role === "corsi"
  const canManageNoShow = canSendMessages
  const [debugCorsi, setDebugCorsi] = useState(false)

  useEffect(() => {
    try {
      setDebugCorsi(localStorage.getItem("fitcenter-debug-corsi") === "1")
    } catch {
      setDebugCorsi(false)
    }
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem("fitcenter-corsi-course-notes")
      if (!raw) return setCourseNotes({})
      const parsed = JSON.parse(raw) as Record<string, string>
      setCourseNotes(parsed && typeof parsed === "object" ? parsed : {})
    } catch {
      setCourseNotes({})
    }
  }, [])

  function noteKeyForCourse(g: CorsoGroup): string {
    // Key stabile anche se cambiano partecipanti; include giorno+servizio+orari
    return `v1:${g.key}`
  }

  function updateCourseNote(g: CorsoGroup, text: string) {
    const k = noteKeyForCourse(g)
    setCourseNotes((prev) => {
      const next = { ...prev, [k]: text }
      try {
        localStorage.setItem("fitcenter-corsi-course-notes", JSON.stringify(next))
      } catch {}
      return next
    })
  }

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

  const accessiDayQ = useQuery({
    queryKey: ["accessi-utenti", giorno],
    queryFn: () => prenotazioniApi.listAccessiRange({ from: giorno, to: giorno }),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
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
  const [selectedCorsoKey, setSelectedCorsoKey] = useState<string | null>(null)

  useEffect(() => {
    if (gruppiFiltrati.length === 0) return setSelectedCorsoKey(null)
    if (selectedCorsoKey && gruppiFiltrati.some((g) => g.key === selectedCorsoKey)) return
    // Default: preferisci un corso con prenotati (non WAITLIST).
    const pick =
      gruppiFiltrati.find((g) => !g.key.includes("__WAITLIST") && g.partecipanti.some((p) => !p.inAttesa)) ??
      gruppiFiltrati.find((g) => !g.key.includes("__WAITLIST")) ??
      gruppiFiltrati[0]!
    setSelectedCorsoKey(pick.key)
  }, [gruppiFiltrati, selectedCorsoKey])

  const selectedCorso = useMemo(() => {
    if (!selectedCorsoKey) return null
    return gruppiFiltrati.find((g) => g.key === selectedCorsoKey) ?? null
  }, [gruppiFiltrati, selectedCorsoKey])

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
    const m = new Map<string, { email: string; blockedAt: string; until?: string; reason: string; monthKey: string; count: number }>()
    for (const b of blocksQ.data?.rows ?? []) {
      const e = String(b.email ?? "").trim().toLowerCase()
      if (!e) continue
      m.set(e, {
        email: e,
        blockedAt: String((b as any)?.blockedAt ?? ""),
        until: (b as any)?.until ? String((b as any).until) : undefined,
        reason: String((b as any)?.reason ?? ""),
        monthKey: String((b as any)?.monthKey ?? ""),
        count: Number((b as any)?.count ?? 0),
      })
    }
    return m
  }, [blocksQ.data])

  function debugPresence(p: PrenotazioneCorsoRow): string {
    const raw = (p.raw ?? {}) as any
    const stable = participantStableKey(p, 0)
    const w = getLessonWindow(p)
    const accessTimes = stable.startsWith("id:") ? (accessIdxDay.get(stable) ?? []) : []
    const accessCount = accessTimes.length
    const firstAccess = accessTimes[0]
    const lastAccess = accessCount > 0 ? accessTimes[accessCount - 1] : undefined
    const startIso = w.start ? w.start.toISOString() : "null"
    const endIso = w.end ? w.end.toISOString() : "null"
    const startLoc = w.start ? `${String(w.start.getHours()).padStart(2, "0")}:${String(w.start.getMinutes()).padStart(2, "0")}` : "null"
    const endLoc = w.end ? `${String(w.end.getHours()).padStart(2, "0")}:${String(w.end.getMinutes()).padStart(2, "0")}` : "null"
    const rawStart = String(raw?.DataInizioPrenotazioneIscrizione ?? raw?.InizioPrenotazioneIscrizione ?? raw?.DataInizio ?? "")
    const rawEnd = String(raw?.DataFinePrenotazioneIscrizione ?? raw?.DataFine ?? "")
    const accessRawSample = String((accessiDayQ.data?.rows?.[0] as any)?.raw?.AccessiDataOra ?? "")
    return [
      `DBG giorno=${giorno}`,
      `stable=${stable}`,
      `rawStart=${rawStart || "—"}`,
      `rawEnd=${rawEnd || "—"}`,
      `start=${startIso} (loc=${startLoc})`,
      `end=${endIso} (loc=${endLoc})`,
      `accessCount=${accessCount}`,
      `firstAccess=${firstAccess ? `${firstAccess.kind}:${firstAccess.t.toISOString()} (loc=${String(firstAccess.t.getHours()).padStart(2, "0")}:${String(firstAccess.t.getMinutes()).padStart(2, "0")})` : "—"}`,
      `lastAccess=${lastAccess ? `${lastAccess.kind}:${lastAccess.t.toISOString()} (loc=${String(lastAccess.t.getHours()).padStart(2, "0")}:${String(lastAccess.t.getMinutes()).padStart(2, "0")})` : "—"}`,
      `sampleAccessRaw=${accessRawSample || "—"}`,
    ].join(" | ")
  }

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
          {enabled ? (
            <p className="mt-1 text-xs text-zinc-500">
              Accessi:{" "}
              {accessiDayQ.isError
                ? `errore (${String((accessiDayQ.error as any)?.message ?? "—")})`
                : String(accessiDayQ.data?.rows?.length ?? 0)}
            </p>
          ) : null}
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
          {canManageNoShow ? (
            <label className="flex items-center gap-2 text-xs text-zinc-400 sm:col-span-2 sm:justify-end">
              <input
                type="checkbox"
                checked={debugCorsi}
                onChange={(e) => {
                  const v = e.target.checked
                  setDebugCorsi(v)
                  try {
                    localStorage.setItem("fitcenter-debug-corsi", v ? "1" : "0")
                  } catch {}
                }}
              />
              Debug
            </label>
          ) : null}
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

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-2 lg:col-span-1">
                <div className="px-2 py-2 text-xs font-semibold text-zinc-400">Elenco corsi</div>
                <div className="max-h-[70vh] overflow-auto">
                  {gruppiFiltrati.map((g) => {
                    const active = g.key === selectedCorsoKey
                    const pren = g.partecipanti.filter((p) => !p.inAttesa).length
                    const att = g.partecipanti.filter((p) => !!p.inAttesa).length
                    const isWait = g.key.includes("__WAITLIST")
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setSelectedCorsoKey(g.key)}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                          active
                            ? "border-amber-500/40 bg-amber-500/10"
                            : "border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900/30"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-zinc-100">
                            {g.servizio}
                            {isWait ? <span className="ml-2 text-xs font-semibold text-fuchsia-200">ATTESA</span> : null}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {fmtDateIt(g.giorno)}
                            {g.oraInizio ? ` · ${fmtTimeDot(g.oraInizio)}` : ""}
                            {g.oraFine ? `–${fmtTimeDot(g.oraFine)}` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {!isWait ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-200">
                              {pren}
                            </span>
                          ) : null}
                          {att > 0 ? (
                            <span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-xs font-semibold text-fuchsia-200">
                              {att}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 shadow-sm lg:col-span-2">
                {!selectedCorso ? (
                  <div className="p-5 text-sm text-zinc-500">Seleziona un corso.</div>
                ) : (
                  (() => {
                    const g = selectedCorso
                    const canMessaggi =
                      canSendMessages && (uniqueValidEmails(g.partecipanti).length > 0 || hasWhatsAppableContacts(g))
                    const courseNote = courseNotes[noteKeyForCourse(g)] ?? ""
                    const presentiCount = g.partecipanti.filter((p, idx) => {
                      const okAppello = isAppelloChecked(g.key, p, idx)
                      const okAccesso = isPresentByAccess(accessIdxDay, p, giorno).present
                      return okAppello || okAccesso
                    }).length
                    const attesaCount = g.partecipanti.filter((p) => !!p.inAttesa).length
                    const assentiCount = Math.max(0, g.partecipanti.length - attesaCount - presentiCount)
                    return (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold tracking-tight text-zinc-100">{g.servizio}</div>
                            <div className="mt-0.5 text-xs text-zinc-500">
                              gio {fmtDateIt(g.giorno)}
                              {g.oraInizio ? ` · ${fmtTimeDot(g.oraInizio)}` : ""}
                              {g.oraFine ? `–${fmtTimeDot(g.oraFine)}` : ""}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <div className="hidden items-center gap-2 text-xs text-zinc-400 sm:flex">
                              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-200">
                                Presenti {presentiCount}
                              </span>
                              <span className="rounded-full border border-zinc-700 bg-zinc-950/20 px-2 py-0.5 font-semibold text-zinc-200">
                                Assenti {assentiCount}
                              </span>
                              {attesaCount > 0 ? (
                                <span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 font-semibold text-fuchsia-200">
                                  Attesa {attesaCount}
                                </span>
                              ) : null}
                            </div>
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

                        <div className="border-b border-zinc-800/60 px-5 py-3">
                          <label className="block text-xs font-medium text-zinc-400">Note corso</label>
                          <textarea
                            value={courseNote}
                            onChange={(e) => updateCourseNote(g, e.target.value)}
                            placeholder="Scrivi note interne per questo corso…"
                            className="mt-1 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                            rows={2}
                          />
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
                        const uscitaAnt = possibileUscitaAnticipata({ ...g, giorno }, p, accessIdxDay)
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
                                {debugCorsi ? (
                                  <div className="mt-1 text-[10px] text-zinc-600" title={debugPresence(p)}>
                                    DBG
                                  </div>
                                ) : null}
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
                          const uscitaAnt = possibileUscitaAnticipata({ ...g, giorno }, p, accessIdxDay)
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
                                  {debugCorsi ? (
                                    <span className="text-[10px] text-zinc-600" title={debugPresence(p)}>
                                      DBG
                                    </span>
                                  ) : null}
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
                      </>
                    )
                  })()
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function CorsiNoShow() {
  const queryClient = useQueryClient()
  const { role } = useAuth()
  const canManageNoShow = role === "admin" || role === "corsi"

  const [dayInMonth, setDayInMonth] = useState(() => isoToday())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState("")
  const testEmail = "carlesi.alessandro@gmail.com"

  const r = useMemo(() => monthRangeFromDay(dayInMonth), [dayInMonth])

  const blocksQ = useQuery({
    queryKey: ["corsi-no-show-blocks"],
    queryFn: () => prenotazioniApi.listNoShowBlocks(),
    enabled: canManageNoShow,
    staleTime: 20_000,
  })

  const rangeQ = useQuery({
    queryKey: ["prenotazioni-corsi-range", r.from, r.to],
    queryFn: () => prenotazioniApi.listPrenotazioniRange({ from: r.from, to: r.to }),
    enabled: canManageNoShow,
    retry: false,
    staleTime: 0,
  })

  const accessiRangeQ = useQuery({
    queryKey: ["accessi-utenti-range", r.from, r.to],
    queryFn: () => prenotazioniApi.listAccessiRange({ from: r.from, to: r.to }),
    enabled: canManageNoShow,
    retry: false,
    staleTime: 0,
  })

  const blockedByEmail = useMemo(() => {
    const m = new Map<string, { email: string; blockedAt: string; until?: string; reason: string; monthKey: string; count: number }>()
    for (const b of blocksQ.data?.rows ?? []) {
      const e = String(b.email ?? "").trim().toLowerCase()
      if (!e) continue
      m.set(e, {
        email: e,
        blockedAt: String((b as any)?.blockedAt ?? ""),
        until: (b as any)?.until ? String((b as any).until) : undefined,
        reason: String((b as any)?.reason ?? ""),
        monthKey: String((b as any)?.monthKey ?? ""),
        count: Number((b as any)?.count ?? 0),
      })
    }
    return m
  }, [blocksQ.data])

  const byDay = useMemo(() => {
    if (!accessiRangeQ.data) return new Map<string, AccessIndex>()
    const allAccessRows = accessiRangeQ.data?.rows ?? []
    const daySet = new Set<string>()
    for (const a of allAccessRows) {
      const dt = parseDateAny((a.raw as any)?.AccessiDataOra ?? a.dataEntrata ?? a.dataUscita)
      if (!dt) continue
      daySet.add(localYmd(dt))
    }
    const m = new Map<string, AccessIndex>()
    for (const dayIso of daySet) {
      const dayRows = allAccessRows.filter((a) => {
        const dt = parseDateAny((a.raw as any)?.AccessiDataOra ?? a.dataEntrata ?? a.dataUscita)
        return dt ? localYmd(dt) === dayIso : false
      })
      m.set(dayIso, buildAccessIndexForDay(dayRows, dayIso))
    }
    return m
  }, [accessiRangeQ.data])

  type NoShowRow = { key: string; idUtente?: string; cognome: string; nome: string; email: string; count: number; monthKey: string }

  const allCandidates = useMemo((): NoShowRow[] => {
    if (!rangeQ.data || !accessiRangeQ.data) return []
    const all = rangeQ.data?.rows ?? []
    const counts = new Map<string, NoShowRow>()
    for (const p of all) {
      if (p.inAttesa) continue
      const w = getLessonWindow(p, (p.giorno ?? "").trim())
      const day = w.start ? isoDayUtc(w.start) : ""
      if (!day) continue
      const key = participantStableKey(p, 0)
      const email = (p.email ?? "").trim().toLowerCase()
      const idUtente =
        String(p.idUtente ?? (p.raw as any)?.IDUtente ?? (p.raw as any)?.IdUtente ?? (p.raw as any)?.UtenteId ?? "").trim() || undefined
      const cognome = email === testEmail ? "test" : String(p.cognome ?? "").trim()
      const nome = email === testEmail ? "prova" : String(p.nome ?? "").trim()

      const gk = groupKeyForRow(p)
      const pk = participantStableKey(p, 0)
      const appello = readAppelloForDay(day)
      const presenteAppello = !!appello[`${gk}::${pk}`]
      const accIdx = byDay.get(day) ?? new Map()
      const presenteAccessi = isPresentByAccess(accIdx, p, day).present
      const presente = presenteAppello || presenteAccessi
      if (presente) continue

      const cur = counts.get(key) ?? { key, idUtente, cognome, nome, email, count: 0, monthKey: r.monthKey }
      cur.count += 1
      if (!cur.email && email) cur.email = email
      if (!cur.idUtente && idUtente) cur.idUtente = idUtente
      if (!cur.cognome && cognome) cur.cognome = cognome
      if (!cur.nome && nome) cur.nome = nome
      counts.set(key, cur)
    }
    const out = [...counts.values()]
    out.sort((a, b) => b.count - a.count || a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome) || a.email.localeCompare(b.email))
    return out
  }, [rangeQ.data, accessiRangeQ.data, byDay, r.monthKey])

  const noShowCandidates = useMemo((): NoShowRow[] => {
    const needle = q.trim().toLowerCase()
    const base = showAll ? allCandidates : allCandidates.filter((x) => x.count >= 3)
    if (!needle) return base
    return base.filter((x) => `${x.cognome} ${x.nome} ${x.email}`.toLowerCase().includes(needle))
  }, [allCandidates, showAll, q])

  const selected = useMemo(() => {
    if (!selectedKey) return null
    const s = allCandidates.find((x) => x.key === selectedKey) ?? null
    if (!s) return null
    if ((s.email ?? "").trim().toLowerCase() !== testEmail) return s
    return { ...s, cognome: "test", nome: "prova" }
  }, [allCandidates, selectedKey])

  const selectedBlock = useMemo(() => {
    const e = String(selected?.email ?? "").trim().toLowerCase()
    if (!e) return null
    return blockedByEmail.get(e) ?? null
  }, [blockedByEmail, selected?.email])

  const missedForSelected = useMemo(() => {
    if (!selected) return []
    const all = rangeQ.data?.rows ?? []
    const out: { day: string; servizio: string; oraInizio?: string; oraFine?: string }[] = []
    for (const p of all) {
      if (p.inAttesa) continue
      const key = participantStableKey(p, 0)
      if (key !== selected.key) continue
      const w = getLessonWindow(p)
      const day = w.start ? isoDayUtc(w.start) : ""
      if (!day) continue
      const gk = groupKeyForRow(p)
      const pk = participantStableKey(p, 0)
      const appello = readAppelloForDay(day)
      const presenteAppello = !!appello[`${gk}::${pk}`]
      const accIdx = byDay.get(day) ?? new Map()
      const presenteAccessi = isPresentByAccess(accIdx, p, day).present
      if (presenteAppello || presenteAccessi) continue
      out.push({ day, servizio: getCorsoTitolo(p), oraInizio: (p.oraInizio ?? "").trim() || undefined, oraFine: (p.oraFine ?? "").trim() || undefined })
    }
    out.sort((a, b) => a.day.localeCompare(b.day) || (a.oraInizio ?? "").localeCompare(b.oraInizio ?? "") || a.servizio.localeCompare(b.servizio))
    return out
  }, [selected, rangeQ.data, byDay])

  const notifyBlockMutation = useMutation({
    mutationFn: async (input: { email: string; monthKey: string; count: number }) => {
      if (!canManageNoShow) throw new Error("Permessi insufficienti")
      const subject = "Sospensione temporanea delle prenotazioni"
      const text =
        `Gentile socio,\n\n` +
        `facendo seguito ai nostri precedenti avvisi, ti informiamo che nel mese corrente sono state rilevate oltre 3 assenze senza alcuna cancellazione o preavviso.\n\n` +
        `Come previsto dal regolamento interno, a causa del numero di assenze accumulate, la tua possibilità di prenotare i corsi è sospesa per i prossimi 3 giorni.\n\n` +
        `Ti ricordiamo che la cancellazione tempestiva (tramite APP o segreteria) è fondamentale per permettere ai soci in lista d'attesa di occupare il posto rimasto libero.\n\n` +
        `La funzionalità di prenotazione si riattiverà automaticamente al termine della sospensione. Se ritieni ci sia un errore o per problemi tecnici, puoi rispondere a questa email o chiamarci al numero 0573 572649.\n\n` +
        `Cordiali saluti,\n` +
        `La Segreteria`
      const absences = missedForSelected.map((m) => ({
        day: m.day,
        servizio: m.servizio,
        oraInizio: m.oraInizio,
        oraFine: m.oraFine,
      }))
      const idUtente = selected?.idUtente
      return prenotazioniApi.notifyAndBlockNoShow({
        email: input.email,
        idUtente,
        subject,
        text,
        monthKey: input.monthKey,
        count: input.count,
        blockDays: 3,
        absences,
      })
    },
    onSuccess: async () => {
      await blocksQ.refetch()
      void queryClient.invalidateQueries({ queryKey: ["prenotazioni-corsi-range"] })
    },
  })

  const notifyOnlyMutation = useMutation({
    mutationFn: async (input: { email: string; monthKey: string; count: number }) => {
      if (!canManageNoShow) throw new Error("Permessi insufficienti")
      const subject = "Importante: Gestione delle tue prenotazioni"
      const text =
        `Gentile socio,\n\n` +
        `Abbiamo rilevato che nel mese corrente sono presenti diverse prenotazioni (3 o più) a cui non è seguita la tua partecipazione.\n\n` +
        `Ti chiediamo gentilmente di cancellare la prenotazione tramite APP o in caso di impossibilità di avvisare sempre la segreteria: questo permette ad altri soci in lista d'attesa di partecipare alle lezioni.\n\n` +
        `Nota bene: questa comunicazione funge da preavviso. A partire dal prossimo mese, il raggiungimento di 3 assenze non comunicate comporterà il blocco automatico delle prenotazioni per 3 giorni.\n\n` +
        `Per qualsiasi chiarimento o per segnalarci eventuali problemi tecnici, puoi rispondere a questa email o chiamarci al numero 0573 572649.\n\n` +
        `Certi della tua collaborazione, ti auguriamo una buona giornata.\n` +
        `La Segreteria`
      const absences = missedForSelected.map((m) => ({
        day: m.day,
        servizio: m.servizio,
        oraInizio: m.oraInizio,
        oraFine: m.oraFine,
      }))
      return prenotazioniApi.notifyNoShow({ email: input.email, subject, text, absences })
    },
  })

  const unblockMutation = useMutation({
    mutationFn: async (email: string) => {
      if (!canManageNoShow) throw new Error("Permessi insufficienti")
      const idUtente = selected?.idUtente
      return prenotazioniApi.unblockNoShow({ email, idUtente })
    },
    onSuccess: async () => {
      await blocksQ.refetch()
      if (selected?.email) {
        const subject = "Account ripristinato: puoi tornare a prenotare i tuoi corsi!"
        const text =
          `Gentile socio,\n` +
          `ti informiamo che il periodo di sospensione è terminato e la tua utenza è stata nuovamente abilitata alla prenotazione delle lezioni.\n` +
          `Puoi tornare sin da ora a riservare il tuo posto tramite l'APP o i soliti canali. Ti chiediamo gentilmente, per il futuro, di ricordarti di cancellare le prenotazioni a cui non potrai partecipare, così da aiutarci a garantire il posto a tutti gli atleti.\n` +
          `Per qualsiasi necessità o informazione, la segreteria è a tua disposizione al numero 0573 572649 o rispondendo a questa email.\n` +
          `Ti aspettiamo in palestra!\n` +
          `La Segreteria`
        void prenotazioniApi.notifyNoShow({ email: selected.email, subject, text, absences: [] })
      }
    },
  })

  if (!canManageNoShow) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Assenze (mese)</h2>
          <p className="mt-2 text-sm text-zinc-500">Permessi insufficienti.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Assenze (mese)</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              Regola: conta prenotazioni senza entrata nel giorno (o appello). Assente solo se si vede uscita prima dell’inizio e nessuna entrata dopo.
              Soglia: 3 nel mese.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-zinc-500">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="h-4 w-4 rounded border border-zinc-600 bg-zinc-950/30"
              />
              Mostra anche &lt;3
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca nome/email…"
              className="w-44 rounded-lg border border-zinc-700 bg-zinc-950/30 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
            <label className="text-xs text-zinc-500">Mese</label>
            <input
              type="date"
              value={dayInMonth}
              onChange={(e) => setDayInMonth(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950/30 px-3 py-2 text-xs text-zinc-200"
            />
          </div>
        </div>

        {rangeQ.isError || accessiRangeQ.isError ? (
          <p className="mt-2 text-sm text-red-400">
            Errore analisi: {String(((rangeQ.error as Error) ?? (accessiRangeQ.error as Error))?.message ?? "Errore")}
          </p>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {!rangeQ.data || rangeQ.isFetching || accessiRangeQ.isFetching ? (
              <p className="text-sm text-zinc-500">Analisi in corso…</p>
            ) : noShowCandidates.length === 0 ? (
              <p className="text-sm text-zinc-500">
                {showAll ? "Nessun cliente trovato per il filtro." : "Nessun cliente con 3+ no-show nel mese selezionato."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-950/40">
                      <th className="px-3 py-2 text-xs font-medium text-zinc-400">Cognome</th>
                      <th className="px-3 py-2 text-xs font-medium text-zinc-400">Nome</th>
                      <th className="px-3 py-2 text-xs font-medium text-zinc-400">Email</th>
                      <th className="px-3 py-2 text-xs font-medium text-zinc-400">Assenze</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noShowCandidates.map((x) => {
                      const active = selectedKey === x.key
                      const isBlocked = !!(x.email ? blockedByEmail.get(String(x.email ?? "").trim().toLowerCase()) : null)
                      return (
                        <tr
                          key={x.key}
                          className={`border-b border-zinc-800/50 last:border-0 ${active ? "bg-amber-500/10" : "hover:bg-zinc-800/20"} cursor-pointer`}
                          onClick={() => setSelectedKey(x.key)}
                          title={isBlocked ? "Già bloccato" : "Apri dettaglio"}
                        >
                          <td className="px-3 py-2 text-zinc-200">{x.cognome || "—"}</td>
                          <td className="px-3 py-2 text-zinc-200">{x.nome || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-200">{x.email || "—"}</td>
                          <td className="px-3 py-2 text-zinc-200">{x.count}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
            {!selected ? (
              <div className="text-sm text-zinc-500">Seleziona un cliente per vedere i corsi non usufruiti.</div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">
                    {`${selected.cognome ?? ""} ${selected.nome ?? ""}`.trim() || "Cliente"}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {selected.email ? <span className="font-mono">{selected.email}</span> : "Email non disponibile"}
                    {selected.idUtente ? (
                      <>
                        <span className="mx-2 text-zinc-700">·</span>
                        ID: <span className="font-mono text-zinc-200">{selected.idUtente}</span>
                      </>
                    ) : null}
                    <span className="mx-2 text-zinc-700">·</span>
                    {selected.count} assenze ({selected.monthKey})
                  </div>
                </div>

                {selectedBlock ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 text-xs text-zinc-300">
                    <div className="font-medium text-zinc-200">Blocco prenotazioni</div>
                    <div className="mt-0.5 text-zinc-500">
                      Fino al: <span className="font-mono text-zinc-200">{selectedBlock.until ?? "—"}</span>
                    </div>
                  </div>
                ) : null}

                <div className="max-h-[40vh] overflow-auto rounded-lg border border-zinc-800">
                  {missedForSelected.length === 0 ? (
                    <div className="p-3 text-sm text-zinc-500">Nessun dettaglio trovato.</div>
                  ) : (
                    <ul className="divide-y divide-zinc-800 text-sm">
                      {missedForSelected.map((m, i) => (
                        <li key={`${m.day}-${m.servizio}-${i}`} className="p-3">
                          <div className="font-medium text-zinc-100">{m.servizio}</div>
                          <div className="text-xs text-zinc-500">
                            {fmtDateIt(m.day)}
                            {m.oraInizio ? ` · ${fmtTimeDot(m.oraInizio)}` : ""}
                            {m.oraFine ? `–${fmtTimeDot(m.oraFine)}` : ""}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    disabled={!selected.email || notifyOnlyMutation.isPending}
                    onClick={() => selected.email && notifyOnlyMutation.mutate({ email: selected.email, monthKey: selected.monthKey, count: selected.count })}
                    className="rounded-lg border border-zinc-700 bg-zinc-950/30 px-3 py-2 text-xs font-medium text-zinc-200 disabled:opacity-50"
                    title={!selected.email ? "Email mancante" : "Invia solo email"}
                  >
                    {notifyOnlyMutation.isPending ? "Invio…" : "Invia mail"}
                  </button>

                  <button
                    type="button"
                    disabled={!selected.email || notifyBlockMutation.isPending || !!selectedBlock}
                    onClick={() => selected.email && notifyBlockMutation.mutate({ email: selected.email, monthKey: selected.monthKey, count: selected.count })}
                    className="rounded-lg border border-amber-700/60 bg-amber-950/20 px-3 py-2 text-xs font-medium text-amber-200 disabled:opacity-50"
                    title={!selected.email ? "Email mancante" : selectedBlock ? "Già bloccato" : "Invia email e blocca per 3 giorni"}
                  >
                    {!!selectedBlock ? "Bloccato" : notifyBlockMutation.isPending ? "Invio…" : "Invia mail + blocca"}
                  </button>
                </div>
                {notifyBlockMutation.isSuccess ? (
                  <div className="text-xs text-zinc-500">
                    Gestionale:{" "}
                    {notifyBlockMutation.data?.gestionale?.ok
                      ? `OK (rows=${notifyBlockMutation.data?.gestionale?.rowsAffected ?? 0})`
                      : `KO (${notifyBlockMutation.data?.gestionale?.message ?? "errore"})`}
                  </div>
                ) : null}

                {selected.email && !!selectedBlock ? (
                  <button
                    type="button"
                    disabled={unblockMutation.isPending}
                    onClick={() => unblockMutation.mutate(selected.email!.trim().toLowerCase())}
                    className="rounded-lg border border-zinc-700 bg-zinc-950/30 px-3 py-2 text-xs font-medium text-zinc-200 disabled:opacity-50"
                    title="Sblocca prenotazioni (gestionale) e rimuovi blocco locale"
                  >
                    {unblockMutation.isPending ? "Sblocco…" : "Sblocca"}
                  </button>
                ) : null}
                {unblockMutation.isSuccess ? (
                  <div className="text-xs text-zinc-500">
                    Sblocco gestionale:{" "}
                    {unblockMutation.data?.gestionale?.ok
                      ? `OK (rows=${unblockMutation.data?.gestionale?.rowsAffected ?? 0})`
                      : `KO (${unblockMutation.data?.gestionale?.message ?? "errore"})`}
                  </div>
                ) : null}
                {unblockMutation.isError ? (
                  <div className="text-xs text-red-400">Errore sblocco: {String((unblockMutation.error as Error)?.message ?? "Errore")}</div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
