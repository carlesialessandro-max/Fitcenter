import { Router } from "express"
import multer from "multer"
import { requireAdmin, requireAuth } from "../middleware/auth.js"
import {
  confirmSignature,
  createSignatureRequest,
  createSignatureTemplate,
  deleteSignatureRequest,
  deleteSignatureTemplate,
  downloadSignatureTemplateDocument,
  downloadPublicSignatureDocument,
  exportSignatureAudit,
  getPublicSignatureInfo,
  listSignatureRequests,
  listSignatureTemplates,
  requestSignatureOtp,
  updateSignatureTemplateSlots,
  verifySignatureOtp,
  replaceSignatureTemplateLastPagePrivacy,
  appendSignatureTemplatePrivacyPage,
  getSignaturePrivacyPageText,
  putSignaturePrivacyPageText,
  resetSignaturePrivacyPageText,
  listSignaturePrivacyProfiles,
  createSignaturePrivacyProfile,
  createSignaturePrivacyProfilePdf,
  updateSignaturePrivacyProfile,
  deleteSignaturePrivacyProfile,
  postSignaturePrivacyProfilePdf,
} from "../handlers/signatures.js"

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
})

export const signaturesRouter = Router()

// Public signing flow (no auth token, access via secure token in URL)
signaturesRouter.get("/public/:token", getPublicSignatureInfo)
signaturesRouter.get("/public/:token/document", downloadPublicSignatureDocument)
signaturesRouter.post("/public/:token/request-otp", requestSignatureOtp)
signaturesRouter.post("/public/:token/verify-otp", verifySignatureOtp)
signaturesRouter.post("/public/:token/sign", confirmSignature)

// Admin area
signaturesRouter.get("/admin", requireAuth, listSignatureRequests)
signaturesRouter.post("/admin", requireAuth, upload.single("document"), createSignatureRequest)
signaturesRouter.delete("/admin/:id", requireAuth, deleteSignatureRequest)
signaturesRouter.get("/admin/export-audit", requireAuth, requireAdmin, exportSignatureAudit)
signaturesRouter.get("/admin/privacy-page-text", requireAuth, requireAdmin, getSignaturePrivacyPageText)
signaturesRouter.put("/admin/privacy-page-text", requireAuth, requireAdmin, putSignaturePrivacyPageText)
signaturesRouter.post("/admin/privacy-page-text/reset", requireAuth, requireAdmin, resetSignaturePrivacyPageText)
signaturesRouter.get("/admin/privacy-profiles", requireAuth, requireAdmin, listSignaturePrivacyProfiles)
signaturesRouter.post("/admin/privacy-profiles", requireAuth, requireAdmin, createSignaturePrivacyProfile)
signaturesRouter.post("/admin/privacy-profiles/pdf", requireAuth, requireAdmin, upload.single("document"), createSignaturePrivacyProfilePdf)
signaturesRouter.post("/admin/privacy-profiles/:id/pdf", requireAuth, requireAdmin, upload.single("document"), postSignaturePrivacyProfilePdf)
signaturesRouter.put("/admin/privacy-profiles/:id", requireAuth, requireAdmin, updateSignaturePrivacyProfile)
signaturesRouter.delete("/admin/privacy-profiles/:id", requireAuth, requireAdmin, deleteSignaturePrivacyProfile)
signaturesRouter.get("/admin/templates", requireAuth, listSignatureTemplates)
signaturesRouter.post("/admin/templates", requireAuth, requireAdmin, upload.single("document"), createSignatureTemplate)
signaturesRouter.put("/admin/templates/:id/slots", requireAuth, requireAdmin, updateSignatureTemplateSlots)
signaturesRouter.put("/admin/templates/:id/replace-last-page-privacy", requireAuth, requireAdmin, replaceSignatureTemplateLastPagePrivacy)
signaturesRouter.put("/admin/templates/:id/append-privacy-page", requireAuth, requireAdmin, appendSignatureTemplatePrivacyPage)
signaturesRouter.get("/admin/templates/:id/document", requireAuth, downloadSignatureTemplateDocument)
signaturesRouter.delete("/admin/templates/:id", requireAuth, requireAdmin, deleteSignatureTemplate)

