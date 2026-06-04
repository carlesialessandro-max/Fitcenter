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

export function isSmsConfigured(): boolean {
  const provider = (env("SMS_PROVIDER") ?? "").toLowerCase()
  if (provider === "smshosting") return !!smshostingCredentials()
  if (provider === "twilio") {
    return !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM"))
  }
  if (provider === "http") return !!env("SMS_HTTP_URL")
  return false
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

export async function sendSms(input: { to: string; text: string }): Promise<{ sent: boolean }> {
  const to = normalizeItPhone(input.to)
  if (!to) {
    console.log("[SMS][SKIP] numero non valido (serve cellulare 3xx, es. 3471234567):", String(input.to ?? "").slice(0, 24))
    return { sent: false }
  }
  const provider = (env("SMS_PROVIDER") ?? "").toLowerCase()
  if (!isSmsConfigured()) {
    console.log("[SMS][DRYRUN]", { to: maskPhone(to), text: input.text })
    return { sent: false }
  }

  try {
    if (provider === "smshosting") {
      const creds = smshostingCredentials()
      if (!creds) return { sent: false }
      const body = new URLSearchParams({
        to: toSmshostingMsisdn(to),
        text: input.text,
      })
      const from = env("SMSHOSTING_FROM")
      if (from) body.set("from", from)
      if (env("SMSHOSTING_SANDBOX") === "true") body.set("sandbox", "true")

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
      const errText = await res.text().catch(() => "")
      if (!res.ok) {
        console.log("[SMS][SMSHOSTING-ERROR]", res.status, errText.slice(0, 300))
        return { sent: false }
      }
      try {
        const data = JSON.parse(errText) as { smsInserted?: number; sms?: { status?: string }[] }
        const inserted = Number(data?.smsInserted ?? 0)
        const okStatus = (data?.sms ?? []).some((s) => String(s?.status ?? "").toUpperCase() === "INSERTED")
        if (inserted > 0 || okStatus) return { sent: true }
        console.log("[SMS][SMSHOSTING-NOT-INSERTED]", errText.slice(0, 300))
        return { sent: false }
      } catch {
        return { sent: true }
      }
    }

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
        return { sent: false }
      }
      return { sent: true }
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
        return { sent: false }
      }
      return { sent: true }
    }

    return { sent: false }
  } catch (e) {
    console.log("[SMS][ERROR]", (e as Error)?.message ?? String(e))
    return { sent: false }
  }
}
