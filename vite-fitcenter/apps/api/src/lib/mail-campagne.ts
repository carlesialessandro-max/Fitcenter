import type { Request } from "express"

export const CAMPAGNE_FROM = "info@h2sport.it"
export const ATTIVI_IMAGE_CID = "attivi-locandina"

export function publicSiteUrl(req?: Request): string {
  const envBase = (process.env.SIGN_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? "").trim()
  if (envBase) return envBase.replace(/\/$/, "")
  if (req) {
    const proto = (req.headers["x-forwarded-proto"]?.toString().split(",")[0] ?? req.protocol ?? "https")
      .toString()
      .replace(/:$/, "")
    const host =
      req.headers["x-forwarded-host"]?.toString().split(",")[0]?.trim() || req.get("host") || ""
    if (host) return `${proto}://${host}`
  }
  return "https://crm.h2sport.it"
}

export function campagneUnsubUrl(req?: Request): string {
  return `${publicSiteUrl(req)}/disiscrizione`
}

export function campagnePrivacyUrl(req?: Request): string {
  return `${publicSiteUrl(req)}/informativa`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function campagneFooterText(unsubUrl: string, privacyUrl: string): string {
  return [
    "Copyright © 2023 Aqua Sport SSD a.r.l. P.IVA 01850030477. Tutti i diritti riservati.",
    "",
    `Questa email è stata inviata da ${CAMPAGNE_FROM} perché ti sei registrato alle nostre liste, dando il consenso a ricevere le nostre comunicazioni.`,
    "",
    "Aqua Sport SSD a.r.l., Via Prov.le Lucchese, 139/b 51100 Pistoia",
    "",
    "Affiliata ASI Cod. TOS-PT1153/FIN Cod. TOS-054570 – Registro CONI nr. 236818.",
    "",
    `Annulla Iscrizione: ${unsubUrl}`,
    "Oppure rispondi a questa mail scrivendo Annulla iscrizione.",
    "",
    `Privacy Policy: ${privacyUrl}`,
    "",
    "L'attività di propaganda è in funzione degli scopi istituzionali e necessaria per lo sviluppo e la divulgazione dello Sport dilettantistico nazionale. Per coloro che faranno domanda per la pratica dell'attività istituzionale la Società provvederà al tesseramento di questi ad una delle federazioni o enti sportivi a cui è affiliata.",
  ].join("\n")
}

function campagneFooterHtml(unsubUrl: string, privacyUrl: string): string {
  const unsub = escapeHtml(unsubUrl)
  const privacy = escapeHtml(privacyUrl)
  return `<div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#555;">
<p style="margin:0 0 10px;">Copyright © 2023 Aqua Sport SSD a.r.l. P.IVA 01850030477. Tutti i diritti riservati.</p>
<p style="margin:0 0 10px;">Questa email è stata inviata da ${escapeHtml(CAMPAGNE_FROM)} perché ti sei registrato alle nostre liste, dando il consenso a ricevere le nostre comunicazioni.</p>
<p style="margin:0 0 10px;">Aqua Sport SSD a.r.l., Via Prov.le Lucchese, 139/b 51100 Pistoia</p>
<p style="margin:0 0 10px;">Affiliata ASI Cod. TOS-PT1153/FIN Cod. TOS-054570 – Registro CONI nr. 236818.</p>
<p style="margin:12px 0;"><a href="${unsub}" style="color:#0b5cab;font-weight:bold;text-decoration:underline;">Annulla Iscrizione</a> — oppure rispondi a questa mail scrivendo Annulla iscrizione.</p>
<p style="margin:0 0 10px;"><a href="${privacy}" style="color:#0b5cab;">Privacy Policy</a></p>
<p style="margin:0;">L'attività di propaganda è in funzione degli scopi istituzionali e necessaria per lo sviluppo e la divulgazione dello Sport dilettantistico nazionale. Per coloro che faranno domanda per la pratica dell'attività istituzionale la Società provvederà al tesseramento di questi ad una delle federazioni o enti sportivi a cui è affiliata.</p>
</div>`
}

export function attiviEmailHtml(text: string, withImage: boolean, unsubUrl: string, privacyUrl: string): string {
  const body = escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>")
  const img = withImage
    ? `<p style="margin:0 0 20px;"><img src="cid:${ATTIVI_IMAGE_CID}" alt="Locandina" style="max-width:560px;width:100%;height:auto;border-radius:8px;" /></p>`
    : ""
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;">${img}${body}${campagneFooterHtml(unsubUrl, privacyUrl)}</div>`
}

export function campagneMailBody(req: Request, text: string, withImage: boolean) {
  const unsubUrl = campagneUnsubUrl(req)
  const privacyUrl = campagnePrivacyUrl(req)
  return {
    text: `${text.trim()}\n\n${campagneFooterText(unsubUrl, privacyUrl)}`,
    html: attiviEmailHtml(text, withImage, unsubUrl, privacyUrl),
    headers: {
      "List-Unsubscribe": `<mailto:${CAMPAGNE_FROM}?subject=Annulla%20iscrizione>, <${unsubUrl}>`,
    } as Record<string, string>,
  }
}
