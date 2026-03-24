import type { SignatureAdminItem, SignaturePublicInfo, SignatureSlot, SignatureTemplate } from "@/types/signature"
import { api } from "./client"

const API_BASE = import.meta.env.VITE_API_URL ?? "/api"
const TOKEN_KEY = "fitcenter-token"

export const signaturesApi = {
  listAdmin: () => api.get<SignatureAdminItem[]>("/signatures/admin"),
  exportAudit: () => api.get<{ rows: unknown[]; exportedAt: string }>("/signatures/admin/export-audit"),
  deleteAdmin: (id: string) => api.delete<{ ok: boolean }>(`/signatures/admin/${encodeURIComponent(id)}`),
  listTemplates: () => api.get<SignatureTemplate[]>("/signatures/admin/templates"),
  deleteTemplate: (id: string) => api.delete<{ ok: boolean }>(`/signatures/admin/templates/${encodeURIComponent(id)}`),
  updateTemplateSlots: (id: string, slots: SignatureSlot[]) =>
    api.put<SignatureTemplate>(`/signatures/admin/templates/${encodeURIComponent(id)}/slots`, { slots }),
  getTemplateDocument: async (id: string) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const res = await fetch(`${API_BASE}/signatures/admin/templates/${encodeURIComponent(id)}/document`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message ?? "Errore download template PDF")
    }
    return res.arrayBuffer()
  },

  createAdmin: async (body: { customerEmail: string; customerName?: string; document: File }) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const fd = new FormData()
    fd.append("customerEmail", body.customerEmail)
    if (body.customerName?.trim()) fd.append("customerName", body.customerName.trim())
    fd.append("document", body.document)

    const res = await fetch(`${API_BASE}/signatures/admin`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message ?? "Errore creazione firma")
    }
    return res.json() as Promise<{
      id: string
      token: string
      status: string
      customerEmail: string
      customerName?: string
      createdAt: string
      expiresAt: string
      signingUrl: string
    }>
  },

  createTemplate: async (body: { name: string; document: File }) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const fd = new FormData()
    fd.append("name", body.name)
    fd.append("document", body.document)
    const res = await fetch(`${API_BASE}/signatures/admin/templates`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message ?? "Errore creazione template")
    }
    return res.json() as Promise<SignatureTemplate>
  },

  createFromTemplate: async (body: { templateId: string; customerEmail: string; customerName?: string }) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const fd = new FormData()
    fd.append("templateId", body.templateId)
    fd.append("customerEmail", body.customerEmail)
    if (body.customerName?.trim()) fd.append("customerName", body.customerName.trim())
    const res = await fetch(`${API_BASE}/signatures/admin`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message ?? "Errore creazione richiesta da template")
    }
    return res.json() as Promise<{
      id: string
      token: string
      status: string
      customerEmail: string
      customerName?: string
      createdAt: string
      expiresAt: string
      signingUrl: string
    }>
  },

  getPublicInfo: (token: string) =>
    fetch(`${API_BASE}/signatures/public/${encodeURIComponent(token)}`).then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: r.statusText }))
        throw new Error((err as { message?: string }).message ?? "Errore")
      }
      return r.json() as Promise<SignaturePublicInfo>
    }),

  requestOtp: (token: string) =>
    fetch(`${API_BASE}/signatures/public/${encodeURIComponent(token)}/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(async (r) => {
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((json as { message?: string }).message ?? "Errore OTP")
      return json as { ok: boolean; debugOtp?: string }
    }),

  verifyOtp: (token: string, otp: string) =>
    fetch(`${API_BASE}/signatures/public/${encodeURIComponent(token)}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp }),
    }).then(async (r) => {
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((json as { message?: string }).message ?? "Errore verifica OTP")
      return json as { ok: boolean; signerToken: string }
    }),

  sign: (token: string, signerToken: string, signatureDataUrl: string, fullName?: string, stepId?: string) =>
    fetch(`${API_BASE}/signatures/public/${encodeURIComponent(token)}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerToken, signatureDataUrl, fullName, stepId }),
    }).then(async (r) => {
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((json as { message?: string }).message ?? "Errore firma")
      return json as { ok: boolean; signedAt?: string; completed: boolean; nextStepLabel?: string | null }
    }),

  publicDocumentUrl: (token: string) => `${API_BASE}/signatures/public/${encodeURIComponent(token)}/document`,
}

