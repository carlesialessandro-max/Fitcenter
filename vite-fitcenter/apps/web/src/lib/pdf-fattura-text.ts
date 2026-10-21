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
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist")
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
  }
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise
  const pages = Array.from({ length: Math.min(pdf.numPages, maxPages) }, (_, i) => i + 1)
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

export async function extractPdfTextWithOcr(
  file: File,
  maxPages = 5,
  onProgress?: (progress: number) => void,
  options?: { rotateForConsuntivo?: boolean },
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist")
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
  }
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise
  const firstPageCount = Math.min(2, maxPages)
  const lastPageCount = Math.max(0, maxPages - firstPageCount)
  const pageNumbers =
    pdf.numPages <= maxPages
      ? Array.from({ length: pdf.numPages }, (_, i) => i + 1)
      : [
          ...Array.from({ length: firstPageCount }, (_, i) => i + 1),
          ...Array.from({ length: lastPageCount }, (_, i) => pdf.numPages - lastPageCount + i + 1),
        ]
  const { createWorker } = await import("tesseract.js")
  const worker = await createWorker("ita+eng", undefined, {
    logger: (message) => {
      if (message.status === "recognizing text") onProgress?.(message.progress)
    },
  })
  const parts: string[] = []
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" })
    for (const pageNumber of [...new Set(pageNumbers)]) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 3 })
      let canvas = document.createElement("canvas")
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Impossibile preparare la pagina PDF per OCR")
      await page.render({ canvas, canvasContext: context, viewport }).promise
      let pageText = (await worker.recognize(canvas)).data.text.trim()
      let pageLabel = pageText.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "")
      const isConsuntivoPage = (label: string) => label.includes("costoconsuntivo") && label.includes("periodo")
      if (options?.rotateForConsuntivo && !isConsuntivoPage(pageLabel)) {
        for (const angle of [90, 180, 270]) {
          const rotatedCanvas = document.createElement("canvas")
          const quarterTurn = angle === 90 || angle === 270
          rotatedCanvas.width = quarterTurn ? canvas.height : canvas.width
          rotatedCanvas.height = quarterTurn ? canvas.width : canvas.height
          const rotatedContext = rotatedCanvas.getContext("2d")
          if (!rotatedContext) throw new Error("Impossibile ruotare la pagina PDF per OCR")
          rotatedContext.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2)
          rotatedContext.rotate((angle * Math.PI) / 180)
          rotatedContext.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
          const rotatedText = (await worker.recognize(rotatedCanvas)).data.text.trim()
          const rotatedLabel = rotatedText
            .normalize("NFD")
            .replace(/\p{M}/gu, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
          if (isConsuntivoPage(rotatedLabel)) {
            canvas.width = 0
            canvas.height = 0
            canvas = rotatedCanvas
            pageText = rotatedText
            pageLabel = rotatedLabel
            break
          }
          rotatedCanvas.width = 0
          rotatedCanvas.height = 0
        }
      }
      if (pageText) parts.push(`--- PAGE ${pageNumber} ---\n${pageText}`)
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await worker.terminate()
  }
  return parts.join("\n")
}
