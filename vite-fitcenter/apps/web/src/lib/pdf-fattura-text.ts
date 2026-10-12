/** Estrae testo da un PDF fattura (client, pdfjs). */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist")
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
  }
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise
  const parts: string[] = []
  const n = Math.min(pdf.numPages, 8)
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const line = content.items
      .map((it) => ("str" in it ? String(it.str) : ""))
      .filter(Boolean)
      .join(" ")
    if (line.trim()) parts.push(line)
  }
  return parts.join("\n")
}
