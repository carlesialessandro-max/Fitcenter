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
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { authRouter } from "./routes/auth.js"
import { leadsRouter } from "./routes/leads.js"
import { webhookZapier } from "./handlers/leads.js"
import { dataRouter } from "./routes/data.js"
import { chiamateRouter } from "./routes/chiamate.js"
import { signaturesRouter } from "./routes/signatures.js"
import { prenotazioniRouter } from "./routes/prenotazioni.js"

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
// Dietro Caddy / reverse proxy: host e proto corretti per link firma (SIGN_BASE_URL / getBaseUrl)
if (process.env.TRUST_PROXY !== "false") {
  app.set("trust proxy", 1)
}

// Security headers (dietro reverse proxy / HTTPS consigliato)
app.use(
  helmet({
    // Serve anche la SPA dallo stesso processo: CSP la gestiamo lato Caddy oppure in un secondo step.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
)

// CORS: se non configurato, fallback permissivo (compatibilità).
// In produzione imposta CORS_ORIGINS=https://crm.tuodominio.it,https://altro...
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  })
)

// Rate limit di base (difesa bruteforce/scan). Più stretto su login e webhook.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
)
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false })
const zapierLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false })

// Firma: inviamo immagini base64 (dataURL) -> aumenta limite JSON.
const JSON_LIMIT = process.env.API_JSON_LIMIT?.trim() || "15mb"
// Per HMAC Zapier: conserviamo il raw body.
app.use(
  express.json({
    limit: JSON_LIMIT,
    verify: (req, _res, buf) => {
      ;(req as any).rawBody = buf
    },
  })
)
// Zapier a volte invia payload come application/x-www-form-urlencoded
app.use(
  express.urlencoded({
    extended: true,
    limit: JSON_LIMIT,
    verify: (req, _res, buf) => {
      ;(req as any).rawBody = buf
    },
  })
)
app.use("/api", authRouter)
app.post("/api/auth/login", authLimiter)
app.post("/api/auth/login/otp", authLimiter)
app.get("/api/webhook/zapier", zapierLimiter, webhookZapier)
app.post("/api/webhook/zapier", zapierLimiter, webhookZapier)
app.use("/api", leadsRouter)
app.use("/api", chiamateRouter)
app.use("/api/prenotazioni", prenotazioniRouter)
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
