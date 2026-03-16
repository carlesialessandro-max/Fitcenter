import { Router } from "express"
import { getDashboard, getDettaglioMese, getDettaglioAnno, getVenditeStorico, getTotaliAnni, getClienti, getAbbonamenti, getBudget, setBudget, getLeadsFromGestionale, getSqlStatus, getDebugConsulenti, getAbbonamentiFollowUp, updateAbbonamentiFollowUp, getConvalidazioni, setConvalidazione } from "../handlers/data.js"

export const dataRouter = Router()

dataRouter.get("/debug-consulenti", getDebugConsulenti)
dataRouter.get("/sql-status", getSqlStatus)
dataRouter.get("/dashboard", getDashboard)
dataRouter.get("/vendite-storico", getVenditeStorico)
dataRouter.get("/totali-anni", getTotaliAnni)
dataRouter.get("/dettaglio-mese", getDettaglioMese)
dataRouter.get("/dettaglio-anno", getDettaglioAnno)
dataRouter.get("/clienti", getClienti)
dataRouter.get("/abbonamenti", getAbbonamenti)
dataRouter.get("/budget", getBudget)
dataRouter.post("/budget", setBudget)
dataRouter.get("/leads", getLeadsFromGestionale)
dataRouter.get("/abbonamenti-follow-up", getAbbonamentiFollowUp)
dataRouter.patch("/abbonamenti-follow-up/:abbonamentoId", updateAbbonamentiFollowUp)
dataRouter.get("/convalidazioni", getConvalidazioni)
dataRouter.post("/convalidazioni", setConvalidazione)
