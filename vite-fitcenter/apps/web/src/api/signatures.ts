import type {
  PrivacyProfile,
  PrivacyPageText,
  SignatureAdminListResponse,
  SignatureField,
  SignaturePublicInfo,
  SignatureSlot,
  SignatureTemplate,
} from "@/types/signature"
import { getApiBase } from "./baseUrl"
import { api } from "./client"

const API_BASE = getApiBase()
const TOKEN_KEY = "fitcenter-token"

export const signaturesApi = {
  getPrivacyPageText: () => api.get<PrivacyPageText>("/signatures/admin/privacy-page-text"),
  putPrivacyPageText: (body: PrivacyPageText) =>
    api.put<PrivacyPageText>("/signatures/admin/privacy-page-text", body),
  resetPrivacyPageText: () => api.post<PrivacyPageText>("/signatures/admin/privacy-page-text/reset", {}),
  listPrivacyProfiles: () => api.get<PrivacyProfile[]>("/signatures/admin/privacy-profiles"),
  createPrivacyProfile: (body: { name: string; text: PrivacyPageText }) =>
    api.post<PrivacyProfile>("/signatures/admin/privacy-profiles", body),
  createPrivacyProfilePdf: async (body: { name: string; document: File }) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const fd = new FormData()
    fd.append("name", body.name)
    fd.append("document", body.document)
    const res = await fetch(`${API_BASE}/signatures/admin/privacy-profiles/pdf`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message ?? "Errore creazione profilo privacy (PDF)")
    }
    return res.json() as Promise<PrivacyProfile>
  },
  uploadPrivacyProfilePdf: async (id: string, document: File) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const fd = new FormData()
    fd.append("document", document)
    const res = await fetch(`${API_BASE}/signatures/admin/privacy-profiles/${encodeURIComponent(id)}/pdf`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message ?? "Errore upload PDF privacy")
    }
    return res.json() as Promise<PrivacyProfile>
  },
  updatePrivacyProfile: (id: string, body: { name: string; text: PrivacyPageText }) =>
    api.put<PrivacyProfile>(`/signatures/admin/privacy-profiles/${encodeURIComponent(id)}`, body),
  deletePrivacyProfile: (id: string) =>
    api.delete<{ ok: true }>(`/signatures/admin/privacy-profiles/${encodeURIComponent(id)}`),
  listAdmin: (q?: { from?: string; to?: string; consultant?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams()
    if (q?.from) params.set("from", q.from)
    if (q?.to) params.set("to", q.to)
    if (q?.consultant) params.set("consultant", q.consultant)
    if (q?.page) params.set("page", String(q.page))
    if (q?.limit) params.set("limit", String(q.limit))
    const qs = params.toString()
    return api.get<SignatureAdminListResponse>(`/signatures/admin${qs ? `?${qs}` : ""}`)
  },
  exportAudit: (q?: { id?: string; token?: string }) => {
    const params = new URLSearchParams()
    if (q?.id) params.set("id", q.id)
    if (q?.token) params.set("token", q.token)
    const qs = params.toString()
    return api.get<{ rows: unknown[]; exportedAt: string }>(`/signatures/admin/export-audit${qs ? `?${qs}` : ""}`)
  },
  exportAuditCsv: async (q?: { id?: string; token?: string }) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const params = new URLSearchParams()
    if (q?.id) params.set("id", q.id)
    if (q?.token) params.set("token", q.token)
    const qs = params.toString()
    const res = await fetch(`${API_BASE}/signatures/admin/export-audit.csv${qs ? `?${qs}` : ""}`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message ?? "Errore export audit CSV")
    }
    return res.blob()
  },
  deleteAdmin: (id: string, opts?: { deleteFiles?: boolean }) =>
    api.delete<{ ok: boolean }>(`/signatures/admin/${encodeURIComponent(id)}${opts?.deleteFiles ? "?deleteFiles=1" : ""}`),
  listTemplates: () => api.get<SignatureTemplate[]>("/signatures/admin/templates"),
  deleteTemplate: (id: string) => api.delete<{ ok: boolean }>(`/signatures/admin/templates/${encodeURIComponent(id)}`),
  deleteTemplatePage: (id: string, body?: { page?: number; which?: "last" }) =>
    api.put<{ ok: true; pageDeleted: number; pagesBefore: number; pagesAfter: number }>(
      `/signatures/admin/templates/${encodeURIComponent(id)}/delete-page`,
      body ?? { which: "last" }
    ),
  updateTemplateLayout: (id: string, input: { slots: SignatureSlot[]; fields?: SignatureField[]; privacyProfileId?: string }) =>
    api.put<SignatureTemplate>(`/signatures/admin/templates/${encodeURIComponent(id)}/slots`, input),
  replaceTemplateLastPagePrivacy: (id: string, body?: { privacyProfileId?: string }) =>
    api.put<{ ok: true }>(`/signatures/admin/templates/${encodeURIComponent(id)}/replace-last-page-privacy`, body ?? {}),
  appendTemplatePrivacyPage: (id: string, body?: { privacyProfileId?: string }) =>
    api.put<{ ok: true }>(`/signatures/admin/templates/${encodeURIComponent(id)}/append-privacy-page`, body ?? {}),
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

  createTemplate: async (body: { name: string; document: File; privacyProfileId?: string }) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const fd = new FormData()
    fd.append("name", body.name)
    fd.append("document", body.document)
    if (body.privacyProfileId) fd.append("privacyProfileId", body.privacyProfileId)
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

  createFromTemplate: async (body: {
    templateId: string
    customerEmail: string
    customerName?: string
    customerGestionaleId?: string
    prefill?: Record<string, string>
  }) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const fd = new FormData()
    fd.append("templateId", body.templateId)
    fd.append("customerEmail", body.customerEmail)
    if (body.customerName?.trim()) fd.append("customerName", body.customerName.trim())
    if (body.customerGestionaleId?.trim()) fd.append("customerGestionaleId", body.customerGestionaleId.trim())
    if (body.prefill && Object.keys(body.prefill).length) fd.append("prefill", JSON.stringify(body.prefill))
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

  verifyOtp: (token: string, otp: string, acceptedTerms: boolean) =>
    fetch(`${API_BASE}/signatures/public/${encodeURIComponent(token)}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp, acceptedTerms }),
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

