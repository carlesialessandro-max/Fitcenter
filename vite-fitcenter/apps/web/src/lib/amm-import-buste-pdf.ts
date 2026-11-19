import { amministrazioneApi, type AmmFerieDaFile, type AmmStipendiPdfRiga } from "@/api/amministrazione"
import { extractPdfText, extractPdfTextWithOcr } from "@/lib/pdf-fattura-text"

export async function readBustePagaPdf(
  file: File,
  mese: string,
  onProgress?: (msg: string) => void,
  opts?: { ferie?: boolean },
): Promise<{ dipendenti: AmmStipendiPdfRiga[]; ferie: AmmFerieDaFile[] }> {
  const looksCosto = /costo/i.test(file.name)
  let text = await extractPdfText(file, 250)
  if (!text.trim() || looksCosto || text.trim().length < 120) {
    onProgress?.(opts?.ferie ? "PDF scansito: OCR delle buste in corso…" : "PDF scansito: OCR locale in corso…")
    const ocrText = await extractPdfTextWithOcr(
      file,
      opts?.ferie ? 200 : 5,
      (progress) => onProgress?.(`Lettura OCR: ${Math.round(progress * 100)}%`),
      { rotateForConsuntivo: !opts?.ferie, allPages: Boolean(opts?.ferie) },
    )
    if (ocrText.trim()) text = ocrText
  }
  const parsed = await amministrazioneApi.parseStipendiPdf(text, file.name, mese)
  return { dipendenti: parsed.dipendenti, ferie: parsed.ferie ?? [] }
}
