export type SignatureStatus = "pending" | "signed" | "expired"

export interface SignatureAdminItem {
  id: string
  token: string
  status: SignatureStatus
  createdAt: string
  expiresAt: string
  customerEmail: string
  customerName?: string
  signedAt?: string
  documentOriginalName: string
  signedDocumentFileName?: string
}

export interface SignaturePublicInfo {
  token: string
  status: SignatureStatus
  customerEmailMasked: string
  customerEmail: string
  customerName?: string
  documentOriginalName: string
  expiresAt: string
  signedAt?: string
  totalSteps?: number
  signedSteps?: number
  nextStepId?: string | null
  nextStepLabel?: string | null
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
  privacyProfileId?: string
}

/** Testo della pagina Privacy/Clausole generata nei PDF (admin). */
export interface PrivacyPageText {
  title1: string
  body1: string
  sig1: string
  title2: string
  body2: string
  sig2: string
}

export interface PrivacyProfile {
  id: string
  name: string
  createdAt: string
  text: PrivacyPageText
  pdfFileName?: string
  pdfOriginalName?: string
}

