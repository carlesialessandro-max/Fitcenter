import { Router } from "express"
import {
  listLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  importFromSql,
} from "../handlers/leads.js"
import { requireAdmin, requireAuth } from "../middleware/auth.js"

export const leadsRouter = Router()

leadsRouter.use(requireAuth)
leadsRouter.get("/leads", requireAdmin, listLeads)
leadsRouter.post("/leads/import-sql", requireAdmin, importFromSql)
leadsRouter.get("/leads/:id", requireAdmin, getLead)
leadsRouter.post("/leads", requireAdmin, createLead)
leadsRouter.put("/leads/:id", requireAdmin, updateLead)
leadsRouter.delete("/leads/:id", requireAdmin, deleteLead)
