import express from "express"
import cors from "cors"
import { leadsRouter } from "./routes/leads.js"
import { dataRouter } from "./routes/data.js"
import { chiamateRouter } from "./routes/chiamate.js"

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: true }))
app.use(express.json())
app.use("/api", leadsRouter)
app.use("/api", chiamateRouter)
app.use("/api/data", dataRouter)

app.get("/api/health", (_req, res) => {
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`API FitCenter in ascolto su http://localhost:${PORT}`)
})
