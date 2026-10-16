type PdfItem = { str: string; x: number; y: number }

function linesFromItems(items: PdfItem[]): string[] {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: string[] = []
  let curY = NaN
  let buf: PdfItem[] = []
  const flush = () => {
    if (!buf.length) return
    buf.sort((a, b) => a.x - b.x)
    const s = buf
      .map((x) => x.str)
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim()
    if (s) lines.push(s)
    buf = []
  }
  for (const it of sorted) {
    if (buf.length && Math.abs(it.y - curY) > 3) flush()
    curY = it.y
    buf.push(it)
  }
  flush()
  return lines
}

/** Estrae testo da un PDF fattura (client, pdfjs), raggruppato per riga. */
export async function extractPdfText(
  file: File,
  maxPages = 8,
  opts?: { preferTail?: boolean }
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist")
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
  }
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise
  const pages: number[] = []
  if (opts?.preferTail && pdf.numPages > maxPages) {
    const tail = Math.min(20, pdf.numPages)
    const head = Math.min(2, Math.max(0, pdf.numPages - tail))
    for (let i = 1; i <= head; i++) pages.push(i)
    for (let i = pdf.numPages - tail + 1; i <= pdf.numPages; i++) pages.push(i)
  } else {
    const n = Math.min(pdf.numPages, maxPages)
    for (let i = 1; i <= n; i++) pages.push(i)
  }
  const parts: string[] = []
  for (const i of pages) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items: PdfItem[] = []
    for (const it of content.items) {
      if (!("str" in it) || !it.str) continue
      const tr = (it as { transform?: number[] }).transform
      items.push({
        str: String(it.str),
        x: Number(tr?.[4] ?? 0),
        y: Math.round(Number(tr?.[5] ?? 0) * 2) / 2,
      })
    }
    const lines = linesFromItems(items)
    if (lines.length) parts.push(`--- PAGE ${i} ---\n` + lines.join("\n"))
  }
  return parts.join("\n")
}
