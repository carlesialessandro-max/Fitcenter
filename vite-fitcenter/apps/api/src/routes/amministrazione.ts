import { Router } from "express"
import multer from "multer"
import { requireAdmin, requireAuth } from "../middleware/auth.js"
import {
  deleteAmmSpesa,
  getAmmDashboard,
  getAmmReparti,
  getAmmSpesaPdf,
  getAmmSpese,
  postAmmImport,
  postAmmOcr,
  postAmmSpesa,
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
amministrazioneRouter.use(requireAuth, requireAdmin)

amministrazioneRouter.get("/dashboard", getAmmDashboard)
amministrazioneRouter.get("/reparti", getAmmReparti)
amministrazioneRouter.put("/reparti", putAmmReparto)
amministrazioneRouter.put("/reparti/:id", putAmmReparto)
amministrazioneRouter.get("/spese", getAmmSpese)
amministrazioneRouter.post("/spese/import", postAmmImport)
amministrazioneRouter.post("/spese", upload.single("pdf"), postAmmSpesa)
amministrazioneRouter.put("/spese/:id", upload.single("pdf"), putAmmSpesa)
amministrazioneRouter.delete("/spese/:id", deleteAmmSpesa)
amministrazioneRouter.get("/spese/:id/pdf", getAmmSpesaPdf)
amministrazioneRouter.post("/ocr", postAmmOcr)
