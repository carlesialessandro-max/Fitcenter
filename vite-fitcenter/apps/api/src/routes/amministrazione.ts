import { Router } from "express"
import multer from "multer"
import { requireAdmin, requireAdminOrAlberto, requireAuth } from "../middleware/auth.js"
import {
  deleteAmmBusta,
  deleteAmmSpesa,
  getAmmBuste,
  getAmmCollaboratori,
  getAmmCollaboratoriReport,
  getAmmDashboard,
  getAmmReparti,
  getAmmSpesaPdf,
  getAmmSpese,
  postAmmBusta,
  postAmmBusteConsuntivoImport,
  postAmmBusteImport,
  postAmmImport,
  postAmmOcr,
  postAmmSpesa,
  postAmmStipendiPdf,
  postAmmCollaboratoriImport,
  postAmmCollaboratoriReportImport,
  postAmmCollaboratoreImporto,
  postAmmCollaboratoreRimanenze,
  postAmmCollaboratoreRimborso,
  deleteAmmCollaboratore,
  deleteAmmCollaboratoreRimborso,
  getFicStatus,
  postFicConnect,
  postFicDisconnect,
  postFicSync,
  putAmmBusta,
  putAmmReparto,
  putAmmSpesa,
} from "../handlers/amministrazione.js"

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")
    cb(null, ok)
  },
})

export const amministrazioneRouter = Router()
amministrazioneRouter.use(requireAuth)

amministrazioneRouter.get("/collaboratori/report", requireAdminOrAlberto, getAmmCollaboratoriReport)
amministrazioneRouter.post("/collaboratori/importo", requireAdminOrAlberto, postAmmCollaboratoreImporto)
amministrazioneRouter.post("/collaboratori/rimanenze", requireAdminOrAlberto, postAmmCollaboratoreRimanenze)
amministrazioneRouter.post("/collaboratori/report/import", requireAdminOrAlberto, postAmmCollaboratoriReportImport)

amministrazioneRouter.use(requireAdmin)

amministrazioneRouter.get("/dashboard", getAmmDashboard)
amministrazioneRouter.get("/reparti", getAmmReparti)
amministrazioneRouter.put("/reparti", putAmmReparto)
amministrazioneRouter.put("/reparti/:id", putAmmReparto)
amministrazioneRouter.get("/collaboratori", getAmmCollaboratori)
amministrazioneRouter.post("/collaboratori/import", postAmmCollaboratoriImport)
amministrazioneRouter.post("/collaboratori/rimborsi", postAmmCollaboratoreRimborso)
amministrazioneRouter.delete("/collaboratori/rimborsi/:id", deleteAmmCollaboratoreRimborso)
amministrazioneRouter.delete("/collaboratori/:id", deleteAmmCollaboratore)
amministrazioneRouter.post("/stipendi/pdf", postAmmStipendiPdf)
amministrazioneRouter.get("/buste", getAmmBuste)
amministrazioneRouter.post("/buste/consuntivo/import", postAmmBusteConsuntivoImport)
amministrazioneRouter.post("/buste/import", postAmmBusteImport)
amministrazioneRouter.post("/buste", postAmmBusta)
amministrazioneRouter.put("/buste/:id", putAmmBusta)
amministrazioneRouter.delete("/buste/:id", deleteAmmBusta)
amministrazioneRouter.get("/spese", getAmmSpese)
amministrazioneRouter.post("/spese/import", postAmmImport)
amministrazioneRouter.post("/spese", upload.single("pdf"), postAmmSpesa)
amministrazioneRouter.put("/spese/:id", upload.single("pdf"), putAmmSpesa)
amministrazioneRouter.delete("/spese/:id", deleteAmmSpesa)
amministrazioneRouter.get("/spese/:id/pdf", getAmmSpesaPdf)
amministrazioneRouter.post("/ocr", postAmmOcr)
amministrazioneRouter.get("/fattureincloud", getFicStatus)
amministrazioneRouter.post("/fattureincloud/connect", postFicConnect)
amministrazioneRouter.post("/fattureincloud/disconnect", postFicDisconnect)
amministrazioneRouter.post("/fattureincloud/sync", postFicSync)
