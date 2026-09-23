import { parseCancelRequestIt, parseSlotRequestIt } from "./whatsapp-booking.js"
import {
  findWhatsappTemplate,
  isWhatsappSendConfigured,
  listWhatsappTemplates,
  normalizeWaTo,
  sendWhatsappTemplate,
  sendWhatsappText,
  type WhatsappTemplateInfo,
} from "./whatsapp.js"
import { readLezioniPrivateDb, writeLezioniPrivateDb, type LpRichiesta } from "../store/lezioni-private-db.js"

const LP_TPL_NAME = "lp_avviso_fitcenter"
const LP_TPL_ISTRUTTORE = "lp_avviso_istruttore"
const LP_TPL_GENITORE = "lp_avviso_genitore"
const LP_TPL_FALLBACKS = [
  "lp_avviso_fitcenter",
  "lezione_privata_richiesta_avviso_v2",
  "lezione_privata_richiesta_avviso",
]

function lpPreferredName(): string {
  return (process.env.WHATSAPP_LP_TEMPLATE ?? "").trim() || LP_TPL_NAME
}

function sanitizeLpTemplateParam(text: string): string {
  return text.replace(/[\r\n]+/g, " · ").replace(/\s+/g, " ").trim().slice(0, 500)
}

function isLongWelcomeBody(text?: string): boolean {
  const t = String(text ?? "")
  return /appuntamento in sede|18:30|sabato mattina|h2sport\.it|grazie per aver richiesto informazioni/i.test(t)
}

function isInstructorPingBody(text?: string): boolean {
  return /nuova richiesta di lezione privata/i.test(String(text ?? ""))
}

function isShortApprovedBody(text?: string): boolean {
  const t = String(text ?? "").trim()
  if (!t || isLongWelcomeBody(t) || isInstructorPingBody(t)) return false
  const staticLen = t.replace(/\{\{[^}]+\}\}/g, "").length
  return t.length <= 200 && staticLen <= 160
}

const MANAGER_HINT =
  "In Manager crea lp_avviso_genitore (testo Richiesta ricevuta con {{1}} {{2}} {{3}} in mezzo). Non usare lp_avviso_fitcenter per il genitore."

function placeholderCount(body?: string): number {
  const nums = [...String(body ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
  return nums.length ? Math.max(...nums) : 0
}

function dash(s?: string | null): string {
  const t = sanitizeLpTemplateParam(String(s ?? ""))
  return t || "-"
}

function pickShort(rows: WhatsappTemplateInfo[]): WhatsappTemplateInfo | null {
  const preferred = lpPreferredName()
  const names = [preferred, ...LP_TPL_FALLBACKS]
  const ok = rows.filter((t) => !isLongWelcomeBody(t.bodyText) && isUsableStatus(t.status))
  for (const name of names) {
    const hit = ok.find((t) => t.name === name)
    if (hit) return hit
  }
  return ok.find((t) => isShortApprovedBody(t.bodyText)) ?? null
}

function isUsableStatus(status?: string): boolean {
  const s = String(status ?? "").toUpperCase()
  return s === "APPROVED" || s === "ACTIVE" || s === "QUALITY_PENDING" || s.includes("APPROVED")
}

let listedAllCache: { at: number; rows: WhatsappTemplateInfo[] } | null = null

async function listAllTemplates(): Promise<WhatsappTemplateInfo[]> {
  const now = Date.now()
  if (listedAllCache && now - listedAllCache.at < 30_000) return listedAllCache.rows
  const rows = await listWhatsappTemplates()
  listedAllCache = { at: now, rows }
  return rows
}

async function findUsable(name: string): Promise<WhatsappTemplateInfo | null> {
  const row = await findWhatsappTemplate(name, "it").catch(() => null)
  if (row && isUsableStatus(row.status) && !isLongWelcomeBody(row.bodyText)) return row
  return null
}

async function ensureLpTemplate(kind: "istruttore" | "cliente" | "altro"): Promise<WhatsappTemplateInfo> {
  const names =
    kind === "istruttore"
      ? [LP_TPL_ISTRUTTORE, lpPreferredName(), ...LP_TPL_FALLBACKS]
      : kind === "cliente"
        ? [LP_TPL_GENITORE]
        : [lpPreferredName(), ...LP_TPL_FALLBACKS]
  const seen = new Set<string>()
  for (const name of names) {
    if (!name || seen.has(name)) continue
    seen.add(name)
    const row = await findUsable(name)
    if (row) {
      if (kind === "cliente" && isInstructorPingBody(row.bodyText)) continue
      return row
    }
  }
  const rows = await listAllTemplates()
  if (kind === "cliente") {
    const gen = rows.find(
      (t) =>
        t.name === LP_TPL_GENITORE &&
        isUsableStatus(t.status) &&
        !isLongWelcomeBody(t.bodyText) &&
        !isInstructorPingBody(t.bodyText),
    )
    if (gen) return gen
    throw new Error(
      "Crea in Manager il modello lp_avviso_genitore (Richiesta ricevuta, Italiano). Non usare il testo «hai una nuova richiesta» del modello istruttori.",
    )
  }
  const short = pickShort(rows)
  if (short) return short
  throw new Error(MANAGER_HINT)
}

async function sendLpTemplate(
  telefono: string,
  tpl: WhatsappTemplateInfo,
  oneLine: string,
  fields?: string[],
): Promise<void> {
  const n = placeholderCount(tpl.bodyText)
  const langs = Array.from(new Set([tpl.language || "it", "it"].filter(Boolean)))
  const paramSets: Array<string[] | undefined> = []
  if (fields && fields.length > 1) {
    const count = n > 1 ? n : fields.length
    paramSets.push(Array.from({ length: count }, (_, i) => dash(fields[i])))
  }
  paramSets.push([sanitizeLpTemplateParam(oneLine)])
  paramSets.push(undefined)
  const tries: Array<{ languageCode: string; bodyParams?: string[] }> = []
  for (const languageCode of langs) {
    for (const bodyParams of paramSets) tries.push({ languageCode, bodyParams })
  }
  let last: Error | null = null
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i]!
    try {
      await sendWhatsappTemplate({
        toRaw: telefono,
        templateName: tpl.name,
        languageCode: t.languageCode,
        bodyParams: t.bodyParams,
        skipLog: i < tries.length - 1,
      })
      return
    } catch (e) {
      last = e as Error
    }
  }
  throw last ?? new Error(`Invio template «${tpl.name}» fallito`)
}

export type LpWaKind = "istruttore" | "cliente" | "altro"

/**
 * Istruttore/genitore: se in Manager esistono lp_avviso_istruttore / lp_avviso_genitore
 * (layout con a capo) si usano quelli. Altrimenti lp_avviso_fitcenter con un solo {{1}}.
 */
export async function sendLezionePrivataWhatsapp(
  telefono: string,
  text: string,
  _nome?: string,
  opts?: { kind?: LpWaKind; fields?: string[] },
): Promise<void> {
  void _nome
  if (!normalizeWaTo(telefono)) throw new Error("numero WhatsApp non valido")
  const body = text.trim()
  if (!body) throw new Error("Testo messaggio vuoto")
  const kind = opts?.kind ?? "altro"
  const tpl = await ensureLpTemplate(kind)
  await sendLpTemplate(telefono, tpl, body, opts?.fields)
}

function samePhone(a: string, b: string): boolean {
  const x = normalizeWaTo(a)
  const y = normalizeWaTo(b)
  return Boolean(x && y && x === y)
}

function politeAck(text: string): boolean {
  const t = text.trim().toLowerCase()
  return /^(ok|va bene|grazie|perfetto|si|sì|no|👍|🙏|ricevuto|visto)[\s!.]*$/.test(t) || t.length <= 2
}

function wantsChange(text: string): boolean {
  const t = text.toLowerCase()
  if (parseSlotRequestIt(text)) return true
  return /\b(cambi|cambio|spost|sposta|altro giorno|un altro|altra ora|posso\s+(lun|mar|mer|gio|ven|sab|dom))\b/.test(t)
}

function appendNote(r: LpRichiesta, line: string) {
  r.note = [r.note, line].filter(Boolean).join(" · ")
}

function latestRichiestaByPhone(telefono: string): LpRichiesta | null {
  const db = readLezioniPrivateDb()
  const rows = db.richieste
    .filter((r) => samePhone(r.telefono, telefono) && r.status !== "annullata")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return rows[0] ?? null
}

async function avvisaIstruttori(text: string, istruttoreId?: string) {
  const db = readLezioniPrivateDb()
  let dest = db.instructors.filter((i) => i.attivo && String(i.telefono ?? "").trim())
  if (istruttoreId) {
    const one = dest.filter((i) => i.id === istruttoreId)
    if (one.length) dest = one
  }
  for (const i of dest) {
    try {
      await sendLezionePrivataWhatsapp(i.telefono, text, i.nome)
    } catch (e) {
      console.error("[lp-wa istruttore]", i.nome, (e as Error).message)
    }
  }
}

const CLIENTE_CONTATTA_ISTR =
  "Per annullare o spostare la lezione privata contatta l'istruttore: da WhatsApp non togliamo noi l'orario in vasca."

export async function handleWhatsappLezioniPrivate(params: {
  from?: string
  text?: string
}): Promise<{ handled: boolean; detail?: string }> {
  const from = normalizeWaTo(params.from ?? "") ?? ""
  const text = String(params.text ?? "").trim()
  if (!from || !text || text.startsWith("[")) return { handled: false }
  if (!isWhatsappSendConfigured()) return { handled: false }

  const richiesta = latestRichiestaByPhone(from)
  const wantsCancel = parseCancelRequestIt(text)
  const wantsMove = wantsChange(text)

  if (richiesta && (wantsCancel || wantsMove)) {
    const db = readLezioniPrivateDb()
    const row = db.richieste.find((x) => x.id === richiesta.id)
    if (row) {
      appendNote(row, `WA cliente: «${text.trim().slice(0, 180)}»`)
      writeLezioniPrivateDb(db)
    }
    const azione = wantsCancel ? "annullare" : "spostare"
    await avvisaIstruttori(
      `${richiesta.clienteNome} chiede di ${azione} la lezione privata. Tel ${richiesta.telefono}. Messaggio: «${text.trim().slice(0, 120)}»`,
      richiesta.istruttoreId,
    )
    await sendWhatsappText(from, CLIENTE_CONTATTA_ISTR)
    return { handled: true, detail: wantsCancel ? "cliente chiede annullo → istruttore" : "cliente chiede spostamento → istruttore" }
  }

  const db = readLezioniPrivateDb()
  const instructor = db.instructors.find((i) => i.attivo && samePhone(i.telefono, from))
  if (instructor) {
    if (politeAck(text)) return { handled: true, detail: "istruttore ack" }
    const aperta = db.richieste.find((r) => r.status === "aperta")
    if (aperta && /\b(prendo|prendiamo|ci sto|ok la prendo|io la prendo)\b/i.test(text)) {
      appendNote(aperta, `WA ${instructor.nome}: «${text}»`)
      writeLezioniPrivateDb(db)
      await sendWhatsappText(
        from,
        `Ricevuto ${instructor.nome}. Per fissare vasca e orario apri FitCenter → Lezioni private → Prendi in carico.`,
      )
      return { handled: true, detail: "istruttore prendi" }
    }
    await sendWhatsappText(
      from,
      `Ricevuto. Per le lezioni private usa FitCenter → Lezioni private (prendi in carico, calendario vasche).`,
    )
    return { handled: true, detail: "istruttore handoff fitcenter" }
  }

  if (!richiesta) return { handled: false }
  if (politeAck(text)) return { handled: true, detail: "cliente ack lp" }

  await sendWhatsappText(from, CLIENTE_CONTATTA_ISTR)
  return { handled: true, detail: "cliente guida lp" }
}
