import { Router } from "express"
import { getDashboard, getDettaglioMese, getDettaglioAnno, getVenditeStorico, getVenditeMovimentiCategoriaDurata, getTotaliAnni, getClienti, getAbbonamenti, getAbbonamentiAttiviAnalisi, getBudget, setBudget, getLeadsFromGestionale, assignLeadToMe, getSqlStatus, getDebugConsulenti, getAbbonamentiFollowUp, updateAbbonamentiFollowUp, getCrmAppuntamenti, getCrmAppuntamentiOperatore, getConvalidazioni, setConvalidazione, getOreLavorate, postOraLavorata, deleteOraLavorata, getReportConsulenti, getCassaMovimentiUtenti } from "../handlers/data.js"
import { getCampus, importCampusPlanningExcel, patchCampusCliente, patchCampusWeekNote } from "../handlers/campus.js"
import { requireAdmin, requireAdminOrCampus, requireAuth } from "../middleware/auth.js"
import multer from "multer"
import { getIncassi } from "../handlers/incassi.js"

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

export const dataRouter = Router()

dataRouter.use(requireAuth)

dataRouter.get("/debug-consulenti", getDebugConsulenti)
dataRouter.get("/sql-status", getSqlStatus)
dataRouter.get("/dashboard", getDashboard)
dataRouter.get("/vendite-storico", getVenditeStorico)
dataRouter.get("/vendite-movimenti-andamento", getVenditeMovimentiCategoriaDurata)
dataRouter.get("/totali-anni", requireAdmin, getTotaliAnni)
dataRouter.get("/dettaglio-mese", getDettaglioMese)
dataRouter.get("/dettaglio-anno", requireAdmin, getDettaglioAnno)
dataRouter.get("/clienti", getClienti)
dataRouter.get("/abbonamenti", getAbbonamenti)
dataRouter.get("/abbonamenti-attivi-analisi", requireAdmin, getAbbonamentiAttiviAnalisi)
dataRouter.get("/budget", requireAdmin, getBudget)
dataRouter.post("/budget", requireAdmin, setBudget)
dataRouter.get("/leads", getLeadsFromGestionale)
dataRouter.post("/leads/:id/assign-me", assignLeadToMe)
dataRouter.get("/abbonamenti-follow-up", getAbbonamentiFollowUp)
dataRouter.patch("/abbonamenti-follow-up/:abbonamentoId", updateAbbonamentiFollowUp)
dataRouter.get("/crm-appuntamenti", getCrmAppuntamenti)
dataRouter.get("/crm-appuntamenti-operatore", getCrmAppuntamentiOperatore)
dataRouter.get("/convalidazioni", getConvalidazioni)
dataRouter.post("/convalidazioni", setConvalidazione)
dataRouter.get("/ore-lavorate", getOreLavorate)
dataRouter.post("/ore-lavorate", postOraLavorata)
dataRouter.delete("/ore-lavorate/:id", deleteOraLavorata)
dataRouter.get("/report-consulenti", requireAdmin, getReportConsulenti)
dataRouter.get("/cassa-movimenti-utenti", getCassaMovimentiUtenti)
dataRouter.get("/incassi", requireAdmin, getIncassi)
dataRouter.get("/campus", getCampus)
dataRouter.patch("/campus/:clienteId", patchCampusCliente)
dataRouter.patch("/campus/:clienteId/weeks/:weekKey", patchCampusWeekNote)
dataRouter.post("/campus/import-planning", requireAdminOrCampus, upload.single("file"), importCampusPlanningExcel)
