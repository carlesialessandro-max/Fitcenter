import { amministrazioneApi, type AmmFerieDaFile, type AmmStipendiPdfRiga } from "@/api/amministrazione"
import { extractPdfText, extractPdfTextWithOcr } from "@/lib/pdf-fattura-text"

export async function readBustePagaPdf(
  file: File,
  mese: string,
  onProgress?: (msg: string) => void,
): Promise<{ dipendenti: AmmStipendiPdfRiga[]; ferie: AmmFerieDaFile[] }> {
  const looksCosto = /costo/i.test(file.name)
  let text = await extractPdfText(file, 250)
  if (!text.trim() || looksCosto || text.trim().length < 120) {
    onProgress?.("PDF scansito: OCR locale in corso…")
    const ocrText = await extractPdfTextWithOcr(
      file,
      5,
      (progress) => onProgress?.(`Lettura OCR del riepilogo: ${Math.round(progress * 100)}%`),
      { rotateForConsuntivo: true },
    )
    if (ocrText.trim()) text = ocrText
  }
  const parsed = await amministrazioneApi.parseStipendiPdf(text, file.name, mese)
  return { dipendenti: parsed.dipendenti, ferie: parsed.ferie ?? [] }
}
