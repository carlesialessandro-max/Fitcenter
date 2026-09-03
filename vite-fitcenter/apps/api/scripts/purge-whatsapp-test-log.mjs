#!/usr/bin/env node
/**
 * Cancella dal log WhatsApp le chat di prova (frasi test note).
 *
 * Uso (Prompt come amministratore):
 *   cd C:\fitcenter\vite-fitcenter\vite-fitcenter\apps\api
 *   node scripts/purge-whatsapp-test-log.mjs
 *   node scripts/purge-whatsapp-test-log.mjs --phone 3351234567
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(__dirname, "..")

const TEST_RE = [
  /lo lavo io o lo lavate voi/i,
  /scusami la 25\s*mt/i,
  /tutti i pomeriggi ore 17/i,
  /prenota prova mercoled[iì']?\s*16\s*settembre\s*ore\s*16[.:]45/i,
  /prova scuola_nuoto mercoled/i,
]

function dataDirCandidates() {
  return [
    path.resolve(apiRoot, "data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "apps/api/data"),
  ]
}

function resolveDataDir() {
  return dataDirCandidates().find((d) => fs.existsSync(d)) ?? dataDirCandidates()[0]
}

function phoneKey(raw) {
  let x = String(raw ?? "").replace(/\D/g, "")
  if (x.startsWith("39") && x.length > 10) x = x.slice(2)
  if (x.startsWith("0")) x = x.slice(1)
  return x
}

function customerPhone(e) {
  return e.kind === "message_out" ? phoneKey(e.to) : phoneKey(e.from)
}

const argPhone = process.argv.find((a) => a.startsWith("--phone="))?.slice(8)?.trim()
const dataDir = resolveDataDir()
const filePath = path.join(dataDir, "whatsapp-events.json")

if (!fs.existsSync(filePath)) {
  console.error(`File non trovato: ${filePath}`)
  process.exit(1)
}

const data = JSON.parse(fs.readFileSync(filePath, "utf8"))
const events = Array.isArray(data.events) ? data.events : []

const keys = new Set()
if (argPhone) {
  const k = phoneKey(argPhone)
  if (k) keys.add(k)
} else {
  for (const e of events) {
    const t = String(e.text ?? "")
    if (!TEST_RE.some((re) => re.test(t))) continue
    const c = customerPhone(e)
    if (c) keys.add(c)
  }
}

if (keys.size === 0) {
  console.log("Nessuna chat di prova trovata.")
  process.exit(0)
}

const kept = events.filter((e) => {
  const a = phoneKey(e.from)
  const b = phoneKey(e.to)
  return !keys.has(a) && !keys.has(b)
})
const removed = events.length - kept.length

const bak = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
fs.copyFileSync(filePath, bak)
fs.writeFileSync(filePath, JSON.stringify({ events: kept }, null, 2), "utf8")

console.log(`Rimossi ${removed} eventi per ${[...keys].join(", ")}`)
console.log(`Backup: ${bak}`)
