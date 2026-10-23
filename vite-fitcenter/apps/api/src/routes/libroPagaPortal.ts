import { Router } from "express"
import rateLimit from "express-rate-limit"
import {
  getLpagaMe,
  getLpagaSnapshot,
  getLpagaConvalida,
  getLpagaConvalidaMese,
  postLpagaConvalidaMese,
  getLpagaDeleghe,
  postLpagaLogin,
  postLpagaLogout,
  patchLpagaPersonale,
  postLpagaPersonale,
  removeLpagaPersonale,
  postLpagaTurno,
  postLpagaImportTurniExcel,
  putLpagaConvalidaTurno,
  putLpagaDeleghe,
  putLpagaMensilita,
  putLpagaPersonalePassword,
  removeLpagaTurno,
  requireLpaga,
  requireLpagaAdmin,
  requireLpagaAlberto,
} from "../handlers/libroPagaPortal.js"
import { patchLivello, postLivello, removeLivello } from "../handlers/libroPaga.js"
import {
  getAmmCollaboratoriReport,
  postAmmCollaboratoreImporto,
  postAmmCollaboratoreRimanenze,
  postAmmCollaboratoriImport,
  postAmmCollaboratoriReportImport,
  postAmmStipendiPdf,
} from "../handlers/amministrazione.js"

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
})

export const libroPagaPortalRouter = Router()
libroPagaPortalRouter.post("/login", loginLimiter, postLpagaLogin)
libroPagaPortalRouter.post("/logout", postLpagaLogout)
libroPagaPortalRouter.get("/me", requireLpaga, getLpagaMe)
libroPagaPortalRouter.get("/", requireLpaga, getLpagaSnapshot)
libroPagaPortalRouter.post("/livelli", requireLpaga, requireLpagaAdmin, postLivello)
libroPagaPortalRouter.patch("/livelli/:id", requireLpaga, requireLpagaAdmin, patchLivello)
libroPagaPortalRouter.delete("/livelli/:id", requireLpaga, requireLpagaAdmin, removeLivello)
libroPagaPortalRouter.post("/turni", requireLpaga, postLpagaTurno)
libroPagaPortalRouter.post("/turni/import-excel", requireLpaga, postLpagaImportTurniExcel)
libroPagaPortalRouter.delete("/turni/:id", requireLpaga, removeLpagaTurno)
libroPagaPortalRouter.put("/mensilita", requireLpaga, putLpagaMensilita)
libroPagaPortalRouter.post("/personale", requireLpaga, postLpagaPersonale)
libroPagaPortalRouter.patch("/personale/:id", requireLpaga, patchLpagaPersonale)
libroPagaPortalRouter.delete("/personale/:id", requireLpaga, removeLpagaPersonale)
libroPagaPortalRouter.put("/personale/:id/password", requireLpaga, putLpagaPersonalePassword)
libroPagaPortalRouter.get("/convalida", requireLpaga, getLpagaConvalida)
libroPagaPortalRouter.get("/convalida-mese", requireLpaga, getLpagaConvalidaMese)
libroPagaPortalRouter.post("/convalida-mese", requireLpaga, postLpagaConvalidaMese)
libroPagaPortalRouter.put("/convalida/turno", requireLpaga, putLpagaConvalidaTurno)
libroPagaPortalRouter.get("/deleghe", requireLpaga, getLpagaDeleghe)
libroPagaPortalRouter.put("/deleghe", requireLpaga, putLpagaDeleghe)
libroPagaPortalRouter.get("/collaboratori/report", requireLpaga, requireLpagaAlberto, getAmmCollaboratoriReport)
libroPagaPortalRouter.post("/collaboratori/importo", requireLpaga, requireLpagaAlberto, postAmmCollaboratoreImporto)
libroPagaPortalRouter.post("/collaboratori/rimanenze", requireLpaga, requireLpagaAlberto, postAmmCollaboratoreRimanenze)
libroPagaPortalRouter.post("/collaboratori/report/import", requireLpaga, requireLpagaAlberto, postAmmCollaboratoriReportImport)
libroPagaPortalRouter.post("/stipendi/pdf", requireLpaga, requireLpagaAlberto, postAmmStipendiPdf)
libroPagaPortalRouter.post("/collaboratori/import", requireLpaga, requireLpagaAlberto, postAmmCollaboratoriImport)
