import { Router } from "express"
import {
  listLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  importFromSql,
} from "../handlers/leads.js"

export const leadsRouter = Router()

leadsRouter.get("/leads", listLeads)
leadsRouter.get("/leads/:id", getLead)
leadsRouter.post("/leads", createLead)
leadsRouter.put("/leads/:id", updateLead)
leadsRouter.delete("/leads/:id", deleteLead)
leadsRouter.post("/leads/import-sql", importFromSql)
