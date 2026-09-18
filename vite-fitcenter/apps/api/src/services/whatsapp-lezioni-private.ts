import { parseCancelRequestIt, parseSlotRequestIt } from "./whatsapp-booking.js"
import { isWhatsappSendConfigured, normalizeWaTo, sendWhatsappText } from "./whatsapp.js"
import { readLezioniPrivateDb, writeLezioniPrivateDb, type LpRichiesta } from "../store/lezioni-private-db.js"

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

function cancelRichiesta(r: LpRichiesta, by: string) {
  const db = readLezioniPrivateDb()
  const row = db.richieste.find((x) => x.id === r.id)
  if (!row) return
  row.status = "annullata"
  appendNote(row, `WA annullata (${by})`)
  for (const p of db.pacchetti.filter((x) => x.richiestaId === row.id)) {
    for (const l of p.lezioni) {
      if (l.stato === "prenotata") {
        l.stato = "annullata_cliente"
        l.annullataAt = new Date().toISOString()
        l.annullataBy = by
      }
    }
  }
  writeLezioniPrivateDb(db)
}

export async function handleWhatsappLezioniPrivate(params: {
  from?: string
  text?: string
}): Promise<{ handled: boolean; detail?: string }> {
  const from = normalizeWaTo(params.from ?? "") ?? ""
  const text = String(params.text ?? "").trim()
  if (!from || !text || text.startsWith("[")) return { handled: false }
  if (!isWhatsappSendConfigured()) return { handled: false }

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
        `Ricevuto ${instructor.nome}. Per fissare vasca e orario apri FitCenter → Lezioni private → Prendi in carico.`
      )
      return { handled: true, detail: "istruttore prendi" }
    }
    await sendWhatsappText(
      from,
      `Ricevuto. Per le lezioni private usa FitCenter → Lezioni private (prendi in carico, calendario vasche).`
    )
    return { handled: true, detail: "istruttore handoff fitcenter" }
  }

  const richiesta = latestRichiestaByPhone(from)
  if (!richiesta) return { handled: false }

  if (parseCancelRequestIt(text)) {
    cancelRichiesta(richiesta, richiesta.clienteNome)
    await sendWhatsappText(
      from,
      `Ok, abbiamo annullato la lezione privata di ${richiesta.clienteNome}. Se vuoi riprenotare, passa in reception o fai una nuova richiesta.`
    )
    return { handled: true, detail: "cliente annulla lp" }
  }

  if (wantsChange(text)) {
    const fresh = readLezioniPrivateDb()
    const row = fresh.richieste.find((x) => x.id === richiesta.id)
    if (row) {
      row.quando = text.trim().slice(0, 180)
      appendNote(row, `WA cambio: «${text.trim().slice(0, 180)}»`)
      writeLezioniPrivateDb(fresh)
    }
    await sendWhatsappText(
      from,
      `Abbiamo segnato la nuova disponibilità. L'istruttore ti conferma giorno e ora: l'orario in vasca non si sposta da solo.`
    )
    return { handled: true, detail: "cliente cambio lp" }
  }

  if (politeAck(text)) return { handled: true, detail: "cliente ack lp" }

  await sendWhatsappText(
    from,
    `Per la lezione privata puoi scrivere ANNULLA oppure il giorno/ora che preferisci (es. sabato mattina). Un istruttore ti conferma.`
  )
  return { handled: true, detail: "cliente guida lp" }
}
