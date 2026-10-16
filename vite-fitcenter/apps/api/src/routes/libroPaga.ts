import { Router } from "express"
import { requireAdmin, requireAuth } from "../middleware/auth.js"
import {
  getLibroPaga,
  patchLivello,
  patchPersonale,
  postImportDump,
  getLibroPagaSnapshots,
  postLibroPagaSnapshotNow,
  postLibroPagaRestoreSnapshot,
  postLibroPagaRepairRuoli,
  postLivello,
  postPersonale,
  postTurno,
  putMensilita,
  putPersonalePassword,
  putPresenza,
  getLibroPagaConvalida,
  getLibroPagaConvalidaMese,
  postLibroPagaConvalidaMese,
  putLibroPagaConvalidaTurno,
  getLibroPagaDeleghe,
  putLibroPagaDeleghe,
  removeLivello,
  removePersonale,
  removeTurno,
} from "../handlers/libroPaga.js"

export const libroPagaRouter = Router()
libroPagaRouter.use(requireAuth, requireAdmin)

libroPagaRouter.get("/", getLibroPaga)
libroPagaRouter.post("/import-dump", postImportDump)
libroPagaRouter.get("/snapshots", getLibroPagaSnapshots)
libroPagaRouter.post("/snapshots", postLibroPagaSnapshotNow)
libroPagaRouter.post("/snapshots/restore", postLibroPagaRestoreSnapshot)
libroPagaRouter.post("/repair-ruoli", postLibroPagaRepairRuoli)
libroPagaRouter.post("/livelli", postLivello)
libroPagaRouter.patch("/livelli/:id", patchLivello)
libroPagaRouter.delete("/livelli/:id", removeLivello)
libroPagaRouter.post("/personale", postPersonale)
libroPagaRouter.patch("/personale/:id", patchPersonale)
libroPagaRouter.put("/personale/:id/password", putPersonalePassword)
libroPagaRouter.delete("/personale/:id", removePersonale)
libroPagaRouter.post("/turni", postTurno)
libroPagaRouter.delete("/turni/:id", removeTurno)
libroPagaRouter.put("/turni/:id/presenza", putPresenza)
libroPagaRouter.put("/mensilita", putMensilita)
libroPagaRouter.get("/convalida", getLibroPagaConvalida)
libroPagaRouter.get("/convalida-mese", getLibroPagaConvalidaMese)
libroPagaRouter.post("/convalida-mese", postLibroPagaConvalidaMese)
libroPagaRouter.put("/convalida/turno", putLibroPagaConvalidaTurno)
libroPagaRouter.get("/deleghe", getLibroPagaDeleghe)
libroPagaRouter.put("/deleghe", putLibroPagaDeleghe)
