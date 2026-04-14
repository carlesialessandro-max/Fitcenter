export type SignatureRequestStatus = "pending" | "signed" | "expired"

export interface SignatureAuditEvent {
  at: string
  type:
    | "created"
    | "otp_requested"
    | "otp_verified"
    | "otp_invalid"
    | "signed"
    | "expired"
    | "signature_failed"
  ip?: string
  userAgent?: string
  message?: string
}

export interface SignatureTemplate {
  id: string
  name: string
  fileName: string
  originalName: string
  mimeType: string
  createdAt: string
  active: boolean
  slots: SignatureSlot[]
  fields?: SignatureField[]
}

export interface SignatureSlot {
  id: string
  label: string
  page: number
  x: number
  y: number
  width: number
  height: number
  order: number
}

export interface SignatureField {
  id: string
  label: string
  page: number
  x: number
  y: number
  order: number
  size?: number
  maxWidth?: number
  multiline?: boolean
  lineHeight?: number
  maxLines?: number
}

export interface SignatureStep extends SignatureSlot {
  signedAt?: string
  signatureDataUrl?: string
}

export interface SignatureRequest {
  id: string
  publicToken: string
  status: SignatureRequestStatus
  createdAt: string
  expiresAt: string
  createdByUsername: string
  customerEmail: string
  customerName?: string
  templateId?: string
  templateName?: string
  documentFileName: string
  documentOriginalName: string
  documentMimeType: string
  otpCodeHash?: string
  otpExpiresAt?: string
  otpAttempts: number
  otpVerifiedAt?: string
  signerSessionTokenHash?: string
  signerSessionExpiresAt?: string
  signedAt?: string
  signatureDataUrl?: string
  signatureFullName?: string
  signatureIp?: string
  signatureUserAgent?: string

  /** Valori usati per precompilare il PDF (best-effort) */
  prefill?: Record<string, string>

  /** Id utente (gestionale) per export allegati su server */
  customerGestionaleId?: string

  signedDocumentFileName?: string
  audit: SignatureAuditEvent[]
  steps?: SignatureStep[]
}

