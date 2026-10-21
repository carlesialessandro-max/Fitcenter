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

export async function extractPdfTextWithOcr(
  file: File,
  maxPages = 5,
  onProgress?: (progress: number) => void,
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
  const { createWorker, PSM } = await import("tesseract.js")
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
      const canvas = document.createElement("canvas")
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Impossibile preparare la pagina PDF per OCR")
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const result = await worker.recognize(canvas, {}, { blocks: true })
      let pageText = result.data.text.trim()
      const pageLabel = pageText.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "")
      if (pageLabel.includes("costoconsuntivo")) {
        const words = (result.data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)),
        )
        const header = words.find(
          (word) =>
            word.text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() === "totale" &&
            word.bbox.x0 > canvas.width * 0.6 &&
            word.bbox.y0 < canvas.height * 0.65,
        )
        const footerLabels = words.filter(
          (word) =>
            /^(totale|totali)$/i.test(word.text) &&
            word.bbox.x0 < canvas.width * 0.25 &&
            word.bbox.y0 > canvas.height * 0.75,
        )
        const aziendaLabel = words.find(
          (word) => /^azienda$/i.test(word.text) && word.bbox.x0 < canvas.width * 0.25 && word.bbox.y0 > canvas.height * 0.75,
        )
        if (header && footerLabels.length) {
          const rowLabels = aziendaLabel ? [...footerLabels, aziendaLabel] : footerLabels
          const rowY =
            rowLabels.reduce((sum, word) => sum + (word.bbox.y0 + word.bbox.y1) / 2, 0) / rowLabels.length
          const cropWidth = Math.round(canvas.width * 0.07)
          const cropHeight = Math.round(canvas.height * 0.09)
          const centerX = (header.bbox.x0 + header.bbox.x1) / 2
          const crop = document.createElement("canvas")
          crop.width = cropWidth * 6
          crop.height = cropHeight * 6
          const cropContext = crop.getContext("2d")
          if (!cropContext) throw new Error("Impossibile leggere la cella del totale consuntivo")
          cropContext.drawImage(
            canvas,
            Math.max(0, Math.min(canvas.width - cropWidth, Math.round(centerX - cropWidth / 2))),
            Math.max(0, Math.min(canvas.height - cropHeight, Math.round(rowY - cropHeight / 2))),
            cropWidth,
            cropHeight,
            0,
            0,
            crop.width,
            crop.height,
          )
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_LINE,
            tessedit_char_whitelist: "0123456789,.",
          })
          const totalResult = await worker.recognize(crop)
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.AUTO,
            tessedit_char_whitelist: "",
            preserve_interword_spaces: "1",
          })
          const rawTotal = totalResult.data.text.trim().replace(/[^\d.,]/g, "")
          const digits = rawTotal.replace(/\D/g, "")
          let total: number | null = null
          if (rawTotal.includes(",") || rawTotal.includes(".")) {
            const lastSeparator = Math.max(rawTotal.lastIndexOf(","), rawTotal.lastIndexOf("."))
            const decimalDigits = rawTotal.length - lastSeparator - 1
            if (decimalDigits === 2) {
              const normalized =
                rawTotal.lastIndexOf(",") > rawTotal.lastIndexOf(".")
                  ? rawTotal.replace(/\./g, "").replace(",", ".")
                  : rawTotal.replace(/,/g, "")
              const parsed = Number(normalized)
              if (Number.isFinite(parsed)) total = parsed
            }
          } else if (digits.length >= 5) {
            total = Number(digits) / 100
          }
          if (total != null && total > 0) {
            pageText += `\nTOTALI AZIENDA ${total.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }
          crop.width = 0
          crop.height = 0
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
