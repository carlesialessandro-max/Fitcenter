import { api } from "./client"

export const whatsappApi = {
  sendLead: (body: {
    leadId?: string
    to?: string
    nome?: string
    templateName?: string
    languageCode?: string
  }) =>
    api.post<{ ok: boolean; templateName?: string; message?: string }>("/whatsapp/send-lead", body),
}
