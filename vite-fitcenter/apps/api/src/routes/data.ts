import { Router } from "express"
import { getDashboard, getDettaglioMese, getDettaglioAnno, getVenditeStorico, getVenditeMovimentiCategoriaDurata, getTotaliAnni, getClienti, getAbbonamenti, getAbbonamentiAttiviAnalisi, getBudget, setBudget, getLeadsFromGestionale, assignLeadToMe, getSqlStatus, getDebugConsulenti, getAbbonamentiFollowUp, updateAbbonamentiFollowUp, getCrmAppuntamenti, getConvalidazioni, setConvalidazione, getOreLavorate, postOraLavorata, deleteOraLavorata, getReportConsulenti } from "../handlers/data.js"
import { requireAdmin, requireAuth } from "../middleware/auth.js"

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
dataRouter.get("/convalidazioni", getConvalidazioni)
dataRouter.post("/convalidazioni", setConvalidazione)
dataRouter.get("/ore-lavorate", getOreLavorate)
dataRouter.post("/ore-lavorate", postOraLavorata)
dataRouter.delete("/ore-lavorate/:id", deleteOraLavorata)
dataRouter.get("/report-consulenti", requireAdmin, getReportConsulenti)
