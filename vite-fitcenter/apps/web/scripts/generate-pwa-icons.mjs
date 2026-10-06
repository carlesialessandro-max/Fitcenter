/** Genera icone PWA PNG (sfondo scuro + disco H2). */
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/icons")

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size)
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function paint(x, y, size) {
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  const d = Math.hypot(x - cx, y - cy)
  const r = size * 0.36
  const ring = size * 0.04
  if (d < r - ring) return [70, 166, 217, 255]
  if (d < r) return [245, 158, 11, 255]
  return [9, 9, 11, 255]
}

mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, "icon-192.png"), png(192, paint))
writeFileSync(path.join(outDir, "icon-512.png"), png(512, paint))
writeFileSync(path.join(outDir, "apple-touch-icon.png"), png(180, paint))
console.log("icone PWA scritte in", outDir)
