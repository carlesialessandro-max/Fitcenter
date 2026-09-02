import { api } from "./client"

export type WhatsappLogEvent = {
  id: string
  kind: string
  at: string
  from?: string
  to?: string
  text?: string
  status?: string
  waMessageId?: string
  raw?: unknown
}

export const whatsappApi = {
  sendLead: (body: {
    leadId?: string
    to?: string
    nome?: string
    templateName?: string
    languageCode?: string
  }) =>
    api.post<{ ok: boolean; templateName?: string; message?: string }>("/whatsapp/send-lead", body),

  sendLeadInfo: (body: { leadId: string; corso?: "acquaticita" | "scuola_nuoto" }) =>
    api.post<{
      ok: boolean
      sent?: string[]
      missing?: boolean
      corso?: string
      to?: string
      toDisplay?: string
      message?: string
    }>("/whatsapp/send-lead-info", body),

  listEvents: (params?: { limit?: number; phone?: string; kind?: string; q?: string }) => {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set("limit", String(params.limit))
    if (params?.phone) q.set("phone", params.phone)
    if (params?.kind) q.set("kind", params.kind)
    if (params?.q) q.set("q", params.q)
    const qs = q.toString()
    return api.get<{ total: number; limit: number; events: WhatsappLogEvent[] }>(
      `/whatsapp/events${qs ? `?${qs}` : ""}`
    )
  },
}
