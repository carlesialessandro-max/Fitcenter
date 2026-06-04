function env(k: string): string | undefined {
  const v = process.env[k]
  if (!v) return undefined
  let t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim()
  }
  return t || undefined
}

/**
 * Normalizza cellulare italiano in E.164 (+39...).
 * L'anagrafica può avere solo cifre locali: 3471234567, 0347..., 39347... → sempre +39347...
 */
export function normalizeItPhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null

  if (s.startsWith("+")) {
    const d = s.replace(/[^\d]/g, "")
    if (d.startsWith("39") && /^39\d{9,10}$/.test(d)) return `+${d}`
    if (d.length >= 8 && d.length <= 15) return `+${d}`
    return null
  }

  let digits = s.replace(/\D/g, "")
  if (!digits) return null
  if (digits.startsWith("00")) digits = digits.slice(2)
  if (digits.startsWith("39") && digits.length >= 11 && digits.length <= 12) return `+${digits}`
  if (digits.startsWith("0")) digits = digits.slice(1)
  // Cellulare IT: 3xx + 7 cifre (9–10 cifre senza prefisso internazionale)
  if (/^3\d{8,9}$/.test(digits)) return `+39${digits}`
  return null
}

export function maskPhone(e164: string | null | undefined): string {
  const s = String(e164 ?? "").trim()
  if (!s) return "—"
  if (s.length <= 4) return "***"
  return `${s.slice(0, 4)}***${s.slice(-2)}`
}

export function isSmsSandboxMode(): boolean {
  return env("SMSHOSTING_SANDBOX") === "true"
}

function looksLikePlaceholderCredential(v: string): boolean {
  return /la_tua|your_|esempio|example|placeholder|xxx+|AUTH_KEY|AUTH_SECRET|inserisci|changeme/i.test(v)
}

function smshostingCredentials(): { user: string; pass: string } | null {
  const user = env("SMSHOSTING_AUTH_KEY") ?? env("SMSHOSTING_USER")
  const pass = env("SMSHOSTING_AUTH_SECRET") ?? env("SMSHOSTING_PASSWORD")
  if (!user || !pass) return null
  if (looksLikePlaceholderCredential(user) || looksLikePlaceholderCredential(pass)) {
    console.log(
      "[SMS][CONFIG] Smshosting: USER/PASSWORD sembrano i testi di esempio del .env.example. " +
        "Copia AUTH_KEY e AUTH_SECRET reali da cloud.smshosting.it → Sviluppatori → API."
    )
    return null
  }
  return { user, pass }
}

/** E.164 (+39...) → msisdn per Smshosting (3934...). */
function toSmshostingMsisdn(e164: string): string {
  return e164.replace(/^\+/, "").replace(/\D/g, "")
}

export function getSmsProvider(): string {
  return (env("SMS_PROVIDER") ?? "").toLowerCase()
}

export function isSmsConfigured(): boolean {
  const provider = getSmsProvider()
  if (provider === "smshosting") return !!smshostingCredentials()
  if (provider === "twilio") {
    return !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM"))
  }
  if (provider === "http") return !!env("SMS_HTTP_URL")
  return false
}

export type SendSmsResult = {
  sent: boolean
  msisdn?: string
  detail?: string
  transactionId?: string
}

/** Verifica credenziali Smshosting (GET /user). Solo diagnostica admin. */
export async function probeSmshostingApi(): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const creds = smshostingCredentials()
  if (!creds) return { ok: false, detail: "credenziali_assenti_o_placeholder" }
  try {
    const auth = Buffer.from(`${creds.user}:${creds.pass}`).toString("base64")
    const res = await fetch("https://api.smshosting.it/rest/api/user", {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    })
    const text = await res.text().catch(() => "")
    if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 200) }
    return { ok: true, status: res.status }
  } catch (e) {
    return { ok: false, detail: (e as Error)?.message ?? String(e) }
  }
}

async function sendSmshostingSms(to: string, text: string): Promise<SendSmsResult> {
  const msisdn = toSmshostingMsisdn(to)
  const creds = smshostingCredentials()
  if (!creds) return { sent: false, msisdn, detail: "credenziali_mancanti" }

  if (isSmsSandboxMode()) {
    console.log("[SMS][SANDBOX] SMSHOSTING_SANDBOX=true: nessun SMS reale inviato a", maskPhone(to), `(${msisdn})`)
    return { sent: false, msisdn, detail: "sandbox" }
  }

  const body = new URLSearchParams({ to: msisdn, text })
  const from = env("SMSHOSTING_FROM")
  if (from) body.set("from", from)

  const auth = Buffer.from(`${creds.user}:${creds.pass}`).toString("base64")
  const res = await fetch("https://api.smshosting.it/rest/api/sms/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  })
  const raw = await res.text().catch(() => "")
  if (!res.ok) {
    console.log("[SMS][SMSHOSTING-ERROR]", res.status, raw.slice(0, 400))
    return { sent: false, msisdn, detail: `http_${res.status}` }
  }

  try {
    const data = JSON.parse(raw) as {
      smsInserted?: number
      smsNotInserted?: number
      transactionId?: string
      sms?: { status?: string; statusDetail?: string; to?: string }[]
    }
    const row = data.sms?.[0]
    const st = String(row?.status ?? "").toUpperCase()
    if (st === "NOT_INSERTED") {
      const det = String(row?.statusDetail ?? "NOT_INSERTED")
      console.log("[SMS][SMSHOSTING-NOT-INSERTED]", det, raw.slice(0, 300))
      return { sent: false, msisdn, detail: det, transactionId: data.transactionId }
    }
    const inserted = Number(data.smsInserted ?? 0)
    if (inserted > 0 || st === "INSERTED") {
      console.log("[SMS][SMSHOSTING-OK]", maskPhone(to), msisdn, data.transactionId ?? "")
      return { sent: true, msisdn, transactionId: data.transactionId }
    }
    console.log("[SMS][SMSHOSTING-NOT-INSERTED]", raw.slice(0, 300))
    return { sent: false, msisdn, detail: "not_inserted", transactionId: data.transactionId }
  } catch {
    console.log("[SMS][SMSHOSTING-PARSE-ERROR]", raw.slice(0, 300))
    return { sent: false, msisdn, detail: "risposta_non_json" }
  }
}

export async function sendSms(input: { to: string; text: string }): Promise<SendSmsResult> {
  const to = normalizeItPhone(input.to)
  if (!to) {
    console.log("[SMS][SKIP] numero non valido (serve cellulare 3xx, es. 3471234567):", String(input.to ?? "").slice(0, 24))
    return { sent: false, detail: "numero_non_valido" }
  }
  const provider = getSmsProvider()
  if (!isSmsConfigured()) {
    console.log("[SMS][DRYRUN]", { to: maskPhone(to), text: input.text.slice(0, 80) })
    return { sent: false, msisdn: toSmshostingMsisdn(to), detail: "non_configurato" }
  }

  try {
    if (provider === "smshosting") return await sendSmshostingSms(to, input.text)

    if (provider === "twilio") {
      const sid = env("TWILIO_ACCOUNT_SID")!
      const token = env("TWILIO_AUTH_TOKEN")!
      const from = env("TWILIO_FROM")!
      const body = new URLSearchParams({ To: to, From: from, Body: input.text })
      const auth = Buffer.from(`${sid}:${token}`).toString("base64")
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        console.log("[SMS][TWILIO-ERROR]", res.status, errText.slice(0, 300))
        return { sent: false, detail: `http_${res.status}` }
      }
      return { sent: true, msisdn: to.replace(/^\+/, "") }
    }

    if (provider === "http") {
      const url = env("SMS_HTTP_URL")!
      const bearer = env("SMS_HTTP_BEARER")
      const res = await fetch(url, {
        method: env("SMS_HTTP_METHOD") ?? "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ to, message: input.text, text: input.text }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        console.log("[SMS][HTTP-ERROR]", res.status, errText.slice(0, 300))
        return { sent: false, detail: `http_${res.status}` }
      }
      return { sent: true, msisdn: to.replace(/^\+/, "") }
    }

    return { sent: false, detail: "provider_sconosciuto" }
  } catch (e) {
    console.log("[SMS][ERROR]", (e as Error)?.message ?? String(e))
    return { sent: false, detail: "errore_rete" }
  }
}
