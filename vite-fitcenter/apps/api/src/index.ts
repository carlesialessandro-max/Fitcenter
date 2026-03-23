import path from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"
import dotenv from "dotenv"

// Carica .env: prima da apps/api/.env (risolto rispetto a dist/index.js), poi dalla root
const __dirnameForEnv = path.dirname(fileURLToPath(import.meta.url))
const apiEnvPath = path.resolve(__dirnameForEnv, "../.env")
const rootEnvPath = path.resolve(process.cwd(), ".env")
dotenv.config({ path: apiEnvPath })
if (rootEnvPath !== apiEnvPath) dotenv.config({ path: rootEnvPath })

import express from "express"
import cors from "cors"
import { authRouter } from "./routes/auth.js"
import { leadsRouter } from "./routes/leads.js"
import { webhookZapier } from "./handlers/leads.js"
import { dataRouter } from "./routes/data.js"
import { chiamateRouter } from "./routes/chiamate.js"
import { signaturesRouter } from "./routes/signatures.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? 3001
const HOST = process.env.HOST ?? "0.0.0.0"

/** Cerca la cartella build del frontend (più percorsi a seconda di dove parte il processo). */
function findPublicDir(): string | null {
  const candidates = [
    path.join(__dirname, "../web/dist"),
    path.join(process.cwd(), "apps/web/dist"),
    path.join(process.cwd(), "vite-fitcenter/apps/web/dist"),
    path.join(__dirname, "../../web/dist"),
  ]
  for (const dir of candidates) {
    if (existsSync(dir) && existsSync(path.join(dir, "index.html"))) return dir
  }
  return null
}

const app = express()

app.use(cors({ origin: true }))
app.use(express.json())
// Zapier a volte invia payload come application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }))
app.use("/api", authRouter)
app.get("/api/webhook/zapier", webhookZapier)
app.post("/api/webhook/zapier", webhookZapier)
app.use("/api", leadsRouter)
app.use("/api", chiamateRouter)
app.use("/api/data", dataRouter)
app.use("/api/signatures", signaturesRouter)

app.get("/api/health", (_req, res) => {
  res.json({ ok: true })
})

// Servi il frontend (build in apps/web/dist) se la cartella esiste
const publicDir = findPublicDir()
let frontendServed = false
if (publicDir) {
  app.use(express.static(publicDir))
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next()
    res.sendFile(path.join(publicDir, "index.html"), (err) => {
      if (err) next(err)
    })
  })
  frontendServed = true
}

app.listen(Number(PORT), HOST, () => {
  console.log(`API FitCenter in ascolto su http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`)
  if (HOST === "0.0.0.0") {
    console.log("  In rete: altri PC possono aprire http://<IP-DI-QUESTO-PC>:" + PORT)
  }
  const tableAbb = process.env.GESTIONALE_TABLE_ABBONAMENTI
  const envLoaded = existsSync(apiEnvPath)
  console.log(`  .env: ${envLoaded ? "trovato " + apiEnvPath : "NON trovato " + apiEnvPath}`)
  console.log(`  GESTIONALE_TABLE_ABBONAMENTI: ${tableAbb ?? "(non impostato → si usa AbbonamentiIscrizione)"}`)
  const sqlEnv = process.env.SQL_CONNECTION_STRING
  if (sqlEnv) {
    console.log("  SQL: configurato (verifica: GET /api/data/sql-status)")
  } else {
    console.log("  SQL: non configurato — dati mock. Imposta SQL_CONNECTION_STRING in apps/api/.env")
  }
  if (frontendServed && publicDir) {
    console.log("  Sito: apri http://localhost:" + PORT)
  } else {
    console.log("  Sito: build non trovata. Esegui da vite-fitcenter: pnpm build   poi riavvia. Oppure: pnpm dev e apri http://localhost:5173")
  }
})
