import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { signaturesApi } from "@/api/signatures"
import { useAuth } from "@/contexts/AuthContext"
import type { PrivacyPageText, PrivacyProfile, SignatureField, SignatureSlot } from "@/types/signature"
import { DEFAULT_SIGNATURE_FIELDS, DEFAULT_SIGNATURE_SLOTS } from "@/constants/signatureDefaults"

function fmtDate(v?: string) {
  if (!v) return "—"
  return new Date(v).toLocaleString("it-IT")
}

export function SignaturesAdmin() {
  const { role } = useAuth()
  const isAdmin = role === "admin"
  const [fromDate, setFromDate] = useState<string>("")
  const [toDate, setToDate] = useState<string>("")
  const [consultant, setConsultant] = useState<string>("")
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [documentFile, setDocumentFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateId, setTemplateId] = useState("")
  const [useTemplate, setUseTemplate] = useState(true)
  const [slotsDraft, setSlotsDraft] = useState<SignatureSlot[]>([])
  const [slotsBusy, setSlotsBusy] = useState(false)
  const [selectedSlotId, setSelectedSlotId] = useState<string>("")
  const [fieldsDraft, setFieldsDraft] = useState<SignatureField[]>([])
  const [selectedFieldId, setSelectedFieldId] = useState<string>("")
  const [addFieldId, setAddFieldId] = useState<string>("")
  const [editMode, setEditMode] = useState<"slots" | "fields">("slots")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [previewPage, setPreviewPage] = useState(1)
  const [deletePageNum, setDeletePageNum] = useState<number | "">("")
  const [pageHeightPdf, setPageHeightPdf] = useState(0)
  const [pageWidthPdf, setPageWidthPdf] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pdfBytesCacheRef = useRef<Map<string, ArrayBuffer>>(new Map())
  const pdfjsRef = useRef<any>(null)
  const [templatePdfBytes, setTemplatePdfBytes] = useState<ArrayBuffer | null>(null)
  const [privacyDraft, setPrivacyDraft] = useState<PrivacyPageText | null>(null)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [privacyProfileIdDraft, setPrivacyProfileIdDraft] = useState<string>("default")
  const [newTemplatePrivacyProfileId, setNewTemplatePrivacyProfileId] = useState<string>("default")
  const [newPrivacyProfileName, setNewPrivacyProfileName] = useState("")
  const [newPrivacyProfileBusy, setNewPrivacyProfileBusy] = useState(false)
  const [newPrivacyPdfName, setNewPrivacyPdfName] = useState("")
  const [newPrivacyPdfFile, setNewPrivacyPdfFile] = useState<File | null>(null)
  const [newPrivacyPdfBusy, setNewPrivacyPdfBusy] = useState(false)

  const listQ = useQuery({
    queryKey: ["signatures-admin", fromDate, toDate, consultant, page, limit],
    queryFn: () =>
      signaturesApi.listAdmin({
        from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
        to: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
        consultant: consultant.trim() || undefined,
        page,
        limit,
      }),
    enabled: true,
  })
  const templatesQ = useQuery({
    queryKey: ["signature-templates"],
    queryFn: () => signaturesApi.listTemplates(),
    enabled: true,
  })
  const privacyProfilesQ = useQuery({
    queryKey: ["signature-privacy-profiles"],
    queryFn: () => signaturesApi.listPrivacyProfiles(),
    enabled: isAdmin,
    staleTime: 30_000,
  })
  const privacyTextQ = useQuery({
    queryKey: ["signature-privacy-page-text"],
    queryFn: () => signaturesApi.getPrivacyPageText(),
    enabled: isAdmin,
  })

  useEffect(() => {
    if (privacyTextQ.data) setPrivacyDraft({ ...privacyTextQ.data })
  }, [privacyTextQ.data])

  async function onCreatePrivacyProfile() {
    if (!isAdmin) return
    if (!privacyDraft) return
    if (!newPrivacyProfileName.trim()) return setErr("Nome profilo privacy obbligatorio")
    setErr(null)
    setMsg(null)
    setNewPrivacyProfileBusy(true)
    try {
      const created = await signaturesApi.createPrivacyProfile({ name: newPrivacyProfileName.trim(), text: privacyDraft })
      setMsg(`Profilo privacy creato: ${created.name}`)
      setNewPrivacyProfileName("")
      await privacyProfilesQ.refetch()
      setNewTemplatePrivacyProfileId(created.id)
      setPrivacyProfileIdDraft(created.id)
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setNewPrivacyProfileBusy(false)
    }
  }

  async function onCreatePrivacyProfilePdf() {
    if (!isAdmin) return
    if (!newPrivacyPdfName.trim()) return setErr("Nome profilo privacy (PDF) obbligatorio")
    if (!newPrivacyPdfFile) return setErr("Seleziona il PDF informativa")
    setErr(null)
    setMsg(null)
    setNewPrivacyPdfBusy(true)
    try {
      const created = await signaturesApi.createPrivacyProfilePdf({ name: newPrivacyPdfName.trim(), document: newPrivacyPdfFile })
      setMsg(`Profilo privacy (PDF) creato: ${created.name}`)
      setNewPrivacyPdfName("")
      setNewPrivacyPdfFile(null)
      await privacyProfilesQ.refetch()
      setNewTemplatePrivacyProfileId(created.id)
      setPrivacyProfileIdDraft(created.id)
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setNewPrivacyPdfBusy(false)
    }
  }

  useEffect(() => {
    if (!templateId) {
      setSlotsDraft([])
      setFieldsDraft([])
      return
    }
    const t = (templatesQ.data ?? []).find((x) => x.id === templateId)
    setPrivacyProfileIdDraft(t?.privacyProfileId ?? "default")
    const slots = t?.slots && t.slots.length > 0 ? t.slots : DEFAULT_SIGNATURE_SLOTS
    setSlotsDraft(slots.map((s) => ({ ...s })))
    // Se il template ha `fields` (anche vuoto), rispetta il valore salvato.
    // I default servono solo per template legacy senza proprietà `fields`.
    const fields = Array.isArray(t?.fields) ? t!.fields : DEFAULT_SIGNATURE_FIELDS
    setFieldsDraft(fields.map((f) => ({ ...f })))
  }, [templateId, templatesQ.data])

  useEffect(() => {
    if (!slotsDraft.length) {
      setSelectedSlotId("")
      return
    }
    const exists = slotsDraft.some((s) => s.id === selectedSlotId)
    if (!exists) setSelectedSlotId(slotsDraft[0]?.id ?? "")
  }, [slotsDraft, selectedSlotId])

  const selectedSlot = useMemo(() => slotsDraft.find((s) => s.id === selectedSlotId) ?? null, [slotsDraft, selectedSlotId])

  useEffect(() => {
    if (!fieldsDraft.length) {
      setSelectedFieldId("")
      return
    }
    const exists = fieldsDraft.some((f) => f.id === selectedFieldId)
    if (!exists) setSelectedFieldId(fieldsDraft[0]?.id ?? "")
  }, [fieldsDraft, selectedFieldId])

  const selectedField = useMemo(
    () => fieldsDraft.find((f) => f.id === selectedFieldId) ?? null,
    [fieldsDraft, selectedFieldId]
  )

  function updateSlot(id: string, patch: Partial<SignatureSlot>) {
    setSlotsDraft((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function removeSlot(id: string) {
    setSlotsDraft((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((s) => s.id !== id)
      return next.map((s, i) => ({ ...s, order: i + 1 }))
    })
  }

  function addNextDefaultSlot() {
    setSlotsDraft((prev) => {
      const used = new Set(prev.map((s) => s.id))
      const nextDef = DEFAULT_SIGNATURE_SLOTS.find((d) => !used.has(d.id))
      if (!nextDef) return prev
      return [...prev, { ...nextDef, order: prev.length + 1 }]
    })
  }

  function addCustomSlot() {
    const label = String(globalThis.prompt("Nome slot firma (es. 'Firma genitore 1')") ?? "").trim()
    if (!label) return
    const baseId = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "firma"
    setSlotsDraft((prev) => {
      const used = new Set(prev.map((s) => s.id))
      let id = baseId
      let i = 2
      while (used.has(id)) {
        id = `${baseId}-${i++}`
      }
      const order = prev.length > 0 ? Math.max(...prev.map((s) => s.order || 0)) + 1 : 1
      return [
        ...prev,
        {
          id,
          label,
          page: 1,
          x: 330,
          y: 90,
          width: 240,
          height: 80,
          order,
        },
      ]
    })
  }

  function resetFiveDefaults() {
    setSlotsDraft(DEFAULT_SIGNATURE_SLOTS.map((s) => ({ ...s })))
  }

  function updateField(id: string, patch: Partial<SignatureField>) {
    setFieldsDraft((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  function removeField(id: string) {
    setFieldsDraft((prev) => {
      const next = prev.filter((f) => f.id !== id)
      if (next.length === 0) return []
      // riallinea ordini (stabile)
      return next
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((f, i) => ({ ...f, order: i + 1 }))
    })
  }

  function clearAllFields() {
    setFieldsDraft([])
    setSelectedFieldId("")
    setAddFieldId("")
  }

  function addFieldFromDefaults(id: string) {
    const def = DEFAULT_SIGNATURE_FIELDS.find((d) => d.id === id)
    if (!def) return
    setFieldsDraft((prev) => {
      if (prev.some((f) => f.id === id)) return prev
      const maxOrder = prev.reduce((m, f) => Math.max(m, f.order ?? 0), 0)
      return [...prev, { ...def, order: maxOrder + 1 }]
    })
    setSelectedFieldId(id)
  }

  function resetDefaultFields() {
    setFieldsDraft(DEFAULT_SIGNATURE_FIELDS.map((f) => ({ ...f })))
  }

  // Scarica bytes PDF solo quando cambia templateId (cache in memoria).
  useEffect(() => {
    let cancelled = false
    async function loadBytes() {
      if (!templateId) return setTemplatePdfBytes(null)
      const cached = pdfBytesCacheRef.current.get(templateId)
      if (cached) return setTemplatePdfBytes(cached)
      setPreviewErr(null)
      setPreviewLoading(true)
      try {
        const bytes = await signaturesApi.getTemplateDocument(templateId)
        if (cancelled) return
        pdfBytesCacheRef.current.set(templateId, bytes)
        setTemplatePdfBytes(bytes)
      } catch (e) {
        if (!cancelled) setPreviewErr((e as Error).message)
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }
    void loadBytes()
    return () => {
      cancelled = true
    }
  }, [templateId])

  // Render preview quando cambiano bytes o pagina (no refetch).
  useEffect(() => {
    let cancelled = false
    async function renderPreview() {
      if (!templateId || !canvasRef.current || !templatePdfBytes) return
      setPreviewErr(null)
      setPreviewLoading(true)
      try {
        const pdfjsLib = pdfjsRef.current ?? (await import("pdfjs-dist"))
        pdfjsRef.current = pdfjsLib
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          const workerUrl = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
        }
        // pdf.js può "detached" l'ArrayBuffer quando lo passa al worker.
        // Quindi passiamo sempre una copia fresca.
        const dataCopy = templatePdfBytes.slice(0)
        const task = pdfjsLib.getDocument({ data: dataCopy })
        const pdf = await task.promise
        if (cancelled) return
        setPageCount(pdf.numPages)
        const safePage = Math.min(Math.max(previewPage, 1), pdf.numPages)
        if (safePage !== previewPage) setPreviewPage(safePage)
        const page = await pdf.getPage(safePage)
        const viewport = page.getViewport({ scale: 1.25 })
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        setPageWidthPdf(page.view[2] ?? 0)
        setPageHeightPdf(page.view[3] ?? 0)
        await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: ctx, viewport }).promise
        const scaleX = canvas.width / (page.view[2] || 1)
        const scaleY = canvas.height / (page.view[3] || 1)
        const activeOnPage =
          editMode === "fields"
            ? fieldsDraft.find((f) => f.id === selectedFieldId && (f.page || 1) === safePage)
            : slotsDraft.find((s) => s.id === selectedSlotId && (s.page || 1) === safePage)
        ctx.save()
        if (activeOnPage) {
          if (editMode === "fields") {
            const f = activeOnPage as SignatureField
            const x = f.x * scaleX
            const y = canvas.height - f.y * scaleY
            ctx.lineWidth = 2
            ctx.strokeStyle = "#22c55e"
            ctx.fillStyle = "rgba(34,197,94,0.08)"
            ctx.beginPath()
            ctx.arc(x, y, 10, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = "#111827"
            ctx.font = "12px sans-serif"
            ctx.fillText(`${f.order}. ${f.label}`, x + 14, Math.max(12, y - 6))
          } else {
            const s = activeOnPage as SignatureSlot
            const x = s.x * scaleX
            const yTop = canvas.height - (s.y + s.height) * scaleY
            const w = s.width * scaleX
            const h = s.height * scaleY
            ctx.lineWidth = 3
            ctx.strokeStyle = "#f59e0b"
            ctx.fillStyle = "rgba(245,158,11,0.12)"
            ctx.fillRect(x, yTop, w, h)
            ctx.strokeRect(x, yTop, w, h)
            ctx.fillStyle = "#111827"
            ctx.font = "12px sans-serif"
            ctx.fillText(`${s.order}. ${s.label}`, x + 4, Math.max(12, yTop - 4))
          }
        }
        ctx.restore()
      } catch (e) {
        if (!cancelled) setPreviewErr((e as Error).message)
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }
    void renderPreview()
    return () => {
      cancelled = true
    }
  }, [templateId, templatePdfBytes, previewPage, slotsDraft, selectedSlotId, fieldsDraft, selectedFieldId, editMode])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    if (!customerEmail.trim()) return setErr("Email obbligatoria")
    if (useTemplate) {
      if (!templateId) return setErr("Seleziona un template")
    } else {
      if (!documentFile) return setErr("Seleziona un PDF")
    }
    setBusy(true)
    try {
      const out = useTemplate
        ? await signaturesApi.createFromTemplate({
            templateId,
            customerEmail: customerEmail.trim(),
            customerName: customerName.trim() || undefined,
          })
        : await signaturesApi.createAdmin({
            customerEmail: customerEmail.trim(),
            customerName: customerName.trim() || undefined,
            document: documentFile as File,
          })
      setMsg(`Richiesta creata. Link inviato a ${out.customerEmail}`)
      setCustomerName("")
      setCustomerEmail("")
      setDocumentFile(null)
      await listQ.refetch()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onCreateTemplate(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    if (!templateName.trim()) return setErr("Nome template obbligatorio")
    if (!templateFile) return setErr("Seleziona il PDF template")
    setTemplateBusy(true)
    try {
      const tpl = await signaturesApi.createTemplate({
        name: templateName.trim(),
        document: templateFile,
        privacyProfileId: newTemplatePrivacyProfileId || "default",
      })
      setMsg(`Template creato: ${tpl.name}`)
      setTemplateName("")
      setTemplateFile(null)
      await templatesQ.refetch()
      setTemplateId(tpl.id)
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setTemplateBusy(false)
    }
  }

  async function onDeleteTemplate(id: string) {
    if (!globalThis.confirm("Eliminare il template?")) return
    setErr(null)
    setMsg(null)
    try {
      await signaturesApi.deleteTemplate(id)
      setMsg("Template eliminato.")
      await templatesQ.refetch()
      if (templateId === id) setTemplateId("")
    } catch (e2) {
      setErr((e2 as Error).message)
    }
  }

  async function onSaveTemplateLayout() {
    if (!templateId || slotsDraft.length === 0) return
    setErr(null)
    setMsg(null)
    setSlotsBusy(true)
    try {
      await signaturesApi.updateTemplateLayout(templateId, {
        slots: slotsDraft,
        fields: fieldsDraft,
        privacyProfileId: privacyProfileIdDraft || "default",
      })
      setMsg("Layout (firme + campi) salvato sul template.")
      await templatesQ.refetch()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setSlotsBusy(false)
    }
  }

  async function onReplaceLastPagePrivacy() {
    if (!templateId) return
    if (
      !globalThis.confirm(
        "Sostituire l'ultima pagina del template con la nuova Informativa/Clausole (senza cambiare i puntamenti delle altre pagine)?"
      )
    ) {
      return
    }
    setErr(null)
    setMsg(null)
    try {
      await signaturesApi.replaceTemplateLastPagePrivacy(templateId, { privacyProfileId: privacyProfileIdDraft || "default" })
      setMsg("Ultima pagina aggiornata (privacy/clausole).")
      // Forzo refresh anteprima: cambio pagina e ritorno (trigger useEffect).
      const curr = previewPage
      setPreviewPage(1)
      if (curr !== 1) setTimeout(() => setPreviewPage(curr), 0)
    } catch (e2) {
      setErr((e2 as Error).message)
    }
  }

  async function onSavePrivacyPageText() {
    if (!privacyDraft) return
    setErr(null)
    setMsg(null)
    setPrivacyBusy(true)
    try {
      const next = await signaturesApi.putPrivacyPageText(privacyDraft)
      setPrivacyDraft(next)
      setMsg("Testo pagina Privacy (PDF) salvato.")
      await privacyTextQ.refetch()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setPrivacyBusy(false)
    }
  }

  async function onResetPrivacyPageText() {
    if (!globalThis.confirm("Ripristinare il testo predefinito (FitCenter) per la pagina Privacy nei PDF?")) return
    setErr(null)
    setMsg(null)
    setPrivacyBusy(true)
    try {
      const next = await signaturesApi.resetPrivacyPageText()
      setPrivacyDraft(next)
      setMsg("Testo privacy ripristinato ai valori predefiniti.")
      await privacyTextQ.refetch()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setPrivacyBusy(false)
    }
  }

  async function onAppendPrivacyPage() {
    if (!templateId) return
    if (!globalThis.confirm("Aggiungere una nuova pagina Privacy/Clausole in coda al template (senza modificare le pagine esistenti)?")) {
      return
    }
    setErr(null)
    setMsg(null)
    try {
      await signaturesApi.appendTemplatePrivacyPage(templateId, { privacyProfileId: privacyProfileIdDraft || "default" })
      setMsg("Pagina Privacy aggiunta in coda al template.")
      // Forzo refresh anteprima: vai all'ultima pagina (dopo refresh pageCount verrà aggiornato).
      setPreviewPage(1)
      setTimeout(() => setPreviewPage(Math.max(1, pageCount + 1)), 0)
    } catch (e2) {
      setErr((e2 as Error).message)
    }
  }

  async function onDeleteTemplatePage() {
    if (!templateId) return setErr("Seleziona un template")
    const page = deletePageNum === "" ? undefined : Number(deletePageNum)
    const label = page ? `pagina ${page}` : "ultima pagina"
    if (!globalThis.confirm(`Cancellare ${label} dal template? (le pagine successive scaleranno di -1)`)) return
    setErr("")
    try {
      await signaturesApi.deleteTemplatePage(templateId, page ? { page } : { which: "last" })
      setMsg(page ? `Pagina ${page} cancellata dal template.` : "Ultima pagina cancellata dal template.")
      setPreviewPage(1)
      await templatesQ.refetch()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  function duplicateSlotsFromPage1To(page: number) {
    if (page <= 1) return
    const base = slotsDraft.filter((s) => (s.page || 1) === 1)
    if (base.length === 0) return
    const existingIds = new Set(slotsDraft.map((s) => s.id))
    let maxOrder = slotsDraft.reduce((m, s) => Math.max(m, s.order || 0), 0)
    const clones: SignatureSlot[] = base.map((s) => {
      const idBase = `${s.id}-p${page}`
      let id = idBase
      let n = 2
      while (existingIds.has(id)) {
        id = `${idBase}-${n++}`
      }
      existingIds.add(id)
      maxOrder += 1
      return { ...s, id, page, order: maxOrder, label: `${s.label} (p${page})` }
    })
    setSlotsDraft((prev) => [...prev, ...clones])
  }

  function duplicateFieldsFromPage1To(page: number) {
    if (page <= 1) return
    const base = fieldsDraft.filter((f) => (f.page || 1) === 1)
    if (base.length === 0) return
    const existingIds = new Set(fieldsDraft.map((f) => f.id))
    let maxOrder = fieldsDraft.reduce((m, f) => Math.max(m, f.order || 0), 0)
    const clones: SignatureField[] = base.map((f) => {
      const idBase = `${f.id}-p${page}`
      let id = idBase
      let n = 2
      while (existingIds.has(id)) {
        id = `${idBase}-${n++}`
      }
      existingIds.add(id)
      maxOrder += 1
      return { ...f, id, page, order: maxOrder, label: `${f.label} (p${page})` }
    })
    setFieldsDraft((prev) => [...prev, ...clones])
  }

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canvasRef.current || pageHeightPdf <= 0 || pageWidthPdf <= 0) return
    const rect = canvasRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const scaleX = canvasRef.current.width / pageWidthPdf
    const scaleY = canvasRef.current.height / pageHeightPdf
    const xPdf = Math.max(0, px / scaleX)
    if (editMode === "fields") {
      if (!selectedField) return
      const yPdf = Math.max(0, pageHeightPdf - py / scaleY)
      updateField(selectedField.id, { page: previewPage, x: Math.round(xPdf), y: Math.round(yPdf) })
    } else {
      if (!selectedSlot) return
      const yPdf = Math.max(0, pageHeightPdf - py / scaleY - selectedSlot.height)
      updateSlot(selectedSlot.id, { page: previewPage, x: Math.round(xPdf), y: Math.round(yPdf) })
    }
  }

  async function onExportAudit() {
    setErr(null)
    setMsg(null)
    setExportBusy(true)
    try {
      const out = await signaturesApi.exportAudit()
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const el = globalThis.document.createElement("a")
      el.href = url
      el.download = `firma-audit-${new Date().toISOString().slice(0, 10)}.json`
      el.click()
      URL.revokeObjectURL(url)
      setMsg("Audit esportato (JSON).")
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setExportBusy(false)
    }
  }

  async function onExportAuditCsv() {
    try {
      setErr(null)
      setMsg(null)
      setExportBusy(true)
      const blob = await signaturesApi.exportAuditCsv()
      const url = URL.createObjectURL(blob)
      const el = globalThis.document.createElement("a")
      el.href = url
      el.download = `firma-audit-${new Date().toISOString().slice(0, 10)}.csv`
      el.click()
      URL.revokeObjectURL(url)
      setMsg("Audit esportato (CSV).")
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setExportBusy(false)
    }
  }

  async function onDelete(id: string, deleteFiles: boolean) {
    const label = deleteFiles ? "Elimina richiesta + cancella file PDF dal server" : "Elimina solo la riga (PDF rimane sul server)"
    if (!globalThis.confirm(`${label}?\n\nId: ${id}`)) return
    setErr(null)
    setMsg(null)
    setDeletingId(id)
    try {
      await signaturesApi.deleteAdmin(id, { deleteFiles })
      setMsg(deleteFiles ? "Richiesta eliminata e file cancellati." : "Richiesta eliminata (file mantenuti sul server).")
      await listQ.refetch()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-zinc-100">Firme documenti</h1>
      <p className="mt-1 text-sm text-zinc-500">Carica PDF, invia link al cliente, verifica OTP e firma grafica.</p>

      {isAdmin && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={exportBusy}
              onClick={onExportAudit}
              className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
            >
              {exportBusy ? "Esportazione..." : "Esporta audit (JSON)"}
            </button>
            <button
              type="button"
              disabled={exportBusy}
              onClick={onExportAuditCsv}
              className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
            >
              Esporta audit (CSV/Excel)
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="text-sm font-medium text-zinc-300">Testo pagina Privacy (PDF)</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Contenuto usato per &quot;Sostituisci ultima pagina (Privacy)&quot; e &quot;Aggiungi pagina Privacy&quot;. Salva prima di rigenerare il PDF
              del template.
            </p>
            {privacyTextQ.isLoading || !privacyDraft ? (
              <p className="mt-3 text-sm text-zinc-500">Caricamento testo…</p>
            ) : (
              <div className="mt-3 grid gap-3">
                <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/30 p-3">
                  <div className="grid gap-1 text-xs text-zinc-400">
                    <span>Profili Privacy disponibili</span>
                    <select
                      value={privacyProfileIdDraft}
                      onChange={(e) => setPrivacyProfileIdDraft(e.target.value)}
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
                      title="Profilo associato al template selezionato (si salva con 'Salva posizioni sul template')"
                    >
                      {(privacyProfilesQ.data ?? ([] as PrivacyProfile[])).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.pdfOriginalName ? " (PDF)" : ""}
                        </option>
                      ))}
                      {(privacyProfilesQ.data ?? []).length === 0 ? <option value="default">Default</option> : null}
                    </select>
                  </div>
                  <div className="grid gap-1 text-xs text-zinc-400">
                    <span>Crea nuovo profilo da PDF (informativa già impaginata)</span>
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={newPrivacyPdfName}
                        onChange={(e) => setNewPrivacyPdfName(e.target.value)}
                        placeholder="Nome profilo (es. Informativa Bambini)"
                        className="min-w-[14rem] flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
                      />
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(e) => setNewPrivacyPdfFile(e.target.files?.[0] ?? null)}
                        className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-300"
                      />
                      <button
                        type="button"
                        disabled={newPrivacyPdfBusy || !newPrivacyPdfName.trim() || !newPrivacyPdfFile}
                        onClick={() => void onCreatePrivacyProfilePdf()}
                        className="rounded border border-sky-700/60 bg-sky-950/20 px-4 py-2 text-sm font-medium text-sky-200 disabled:opacity-50"
                      >
                        {newPrivacyPdfBusy ? "Upload…" : "Crea profilo PDF"}
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Quando un profilo è PDF, i bottoni “Sostituisci ultima pagina (Privacy)” / “Aggiungi pagina Privacy” copieranno la prima pagina del PDF.
                    </p>
                  </div>
                  <div className="grid gap-1 text-xs text-zinc-400">
                    <span>Crea nuovo profilo (partendo dal testo sotto)</span>
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={newPrivacyProfileName}
                        onChange={(e) => setNewPrivacyProfileName(e.target.value)}
                        placeholder="Nome profilo (es. Bambini / Adulti)"
                        className="min-w-[14rem] flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
                      />
                      <button
                        type="button"
                        disabled={newPrivacyProfileBusy || !newPrivacyProfileName.trim()}
                        onClick={() => void onCreatePrivacyProfile()}
                        className="rounded border border-emerald-700/60 bg-emerald-950/20 px-4 py-2 text-sm font-medium text-emerald-200 disabled:opacity-50"
                      >
                        {newPrivacyProfileBusy ? "Creazione…" : "Crea profilo"}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Nota: la modifica del testo qui sotto aggiorna il testo “default”. I profili nuovi vengono creati come copia del testo corrente.
                  </p>
                </div>
                <label className="grid gap-1 text-xs text-zinc-400">
                  Titolo sezione 1
                  <input
                    value={privacyDraft.title1}
                    onChange={(e) => setPrivacyDraft((p) => (p ? { ...p, title1: e.target.value } : p))}
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
                  />
                </label>
                <label className="grid gap-1 text-xs text-zinc-400">
                  Corpo 1 (usa righe vuote per paragrafi)
                  <textarea
                    value={privacyDraft.body1}
                    onChange={(e) => setPrivacyDraft((p) => (p ? { ...p, body1: e.target.value } : p))}
                    rows={5}
                    className="resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-sm text-zinc-100"
                  />
                </label>
                <label className="grid gap-1 text-xs text-zinc-400">
                  Riga firma 1
                  <input
                    value={privacyDraft.sig1}
                    onChange={(e) => setPrivacyDraft((p) => (p ? { ...p, sig1: e.target.value } : p))}
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
                  />
                </label>
                <label className="grid gap-1 text-xs text-zinc-400">
                  Titolo sezione 2
                  <input
                    value={privacyDraft.title2}
                    onChange={(e) => setPrivacyDraft((p) => (p ? { ...p, title2: e.target.value } : p))}
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
                  />
                </label>
                <label className="grid gap-1 text-xs text-zinc-400">
                  Corpo 2
                  <textarea
                    value={privacyDraft.body2}
                    onChange={(e) => setPrivacyDraft((p) => (p ? { ...p, body2: e.target.value } : p))}
                    rows={8}
                    className="resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-sm text-zinc-100"
                  />
                </label>
                <label className="grid gap-1 text-xs text-zinc-400">
                  Riga firma 2
                  <input
                    value={privacyDraft.sig2}
                    onChange={(e) => setPrivacyDraft((p) => (p ? { ...p, sig2: e.target.value } : p))}
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={privacyBusy}
                    onClick={() => void onSavePrivacyPageText()}
                    className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
                  >
                    {privacyBusy ? "Salvataggio…" : "Salva testo Privacy"}
                  </button>
                  <button
                    type="button"
                    disabled={privacyBusy}
                    onClick={() => void onResetPrivacyPageText()}
                    className="rounded border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Ripristina predefinito
                  </button>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={onCreateTemplate} className="mt-4 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-4">
            <input
              type="text"
              placeholder="Nome template (es. Consenso privacy)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setTemplateFile(e.target.files?.[0] ?? null)}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"
            />
            <select
              value={newTemplatePrivacyProfileId}
              onChange={(e) => setNewTemplatePrivacyProfileId(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
              title="Profilo Privacy/Clausole da associare al template (usato per append/replace pagina Privacy)"
            >
              {(privacyProfilesQ.data ?? ([] as PrivacyProfile[])).map((p) => (
                <option key={p.id} value={p.id}>
                  Privacy: {p.name}
                </option>
              ))}
              {(privacyProfilesQ.data ?? []).length === 0 ? <option value="default">Privacy: Default</option> : null}
            </select>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={templateBusy}
                className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
              >
                {templateBusy ? "Creo template..." : "Crea template"}
              </button>
            </div>
          </form>
        </>
      )}

      <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/30 p-3">
        <p className="mb-2 text-xs text-zinc-500">Template disponibili</p>
        <div className="flex flex-wrap gap-2">
          {(templatesQ.data ?? []).map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded border border-zinc-700 px-2 py-1 text-xs">
              <button
                type="button"
                onClick={() => setTemplateId(t.id)}
                className={templateId === t.id ? "text-amber-400" : "text-zinc-200"}
              >
                {t.name}
              </button>
              {isAdmin && (
                <button type="button" onClick={() => onDeleteTemplate(t.id)} className="text-red-300">
                  elimina
                </button>
              )}
            </div>
          ))}
          {(templatesQ.data ?? []).length === 0 && <span className="text-xs text-zinc-500">Nessun template.</span>}
        </div>
      </div>

      {isAdmin && (
      <div className="mt-3 rounded-lg border border-amber-600/40 bg-amber-950/20 p-4">
        <h2 className="text-sm font-semibold text-amber-200">Regolazione firme sul PDF</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Ogni slot = una firma in sequenza sul PDF. I campi (testo) vengono scritti sul PDF prima della firma usando i dati della cassa. Clic sull&apos;anteprima per posizionare l&apos;elemento attivo.
        </p>
        {!templateId ? (
          <p className="mt-3 text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">Seleziona un template</span>: clic sul nome nella lista &quot;Template disponibili&quot; oppure dal menu &quot;Seleziona template&quot; qui sotto, poi modifica le coordinate e premi Salva.
          </p>
        ) : (
          <>
            <div className="mt-3 rounded border border-zinc-700 bg-zinc-950/40 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-400">Modalità:</span>
                <button
                  type="button"
                  onClick={() => setEditMode("slots")}
                  className={`rounded px-2 py-1 ${editMode === "slots" ? "bg-amber-500 text-zinc-950" : "border border-zinc-700 text-zinc-200"}`}
                >
                  Firme
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode("fields")}
                  className={`rounded px-2 py-1 ${editMode === "fields" ? "bg-emerald-500 text-zinc-950" : "border border-zinc-700 text-zinc-200"}`}
                >
                  Campi
                </button>
                <span className="ml-2 text-zinc-400">{editMode === "fields" ? "Campo attivo:" : "Slot attivo:"}</span>
                {editMode === "fields"
                  ? fieldsDraft.length > 0
                    ? fieldsDraft
                        .slice()
                        .sort((a, b) => a.order - b.order)
                        .map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setSelectedFieldId(f.id)}
                            className={`rounded px-2 py-1 ${
                              selectedFieldId === f.id ? "bg-emerald-500 text-zinc-950" : "border border-zinc-700 text-zinc-200"
                            }`}
                          >
                            {f.order}. {f.label}
                          </button>
                        ))
                    : (
                        <span className="inline-flex flex-wrap items-center gap-2 text-zinc-500">
                          Nessun campo. Aggiungine uno:
                          <select
                            value={addFieldId}
                            onChange={(e) => setAddFieldId(e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                          >
                            <option value="">Seleziona…</option>
                            {DEFAULT_SIGNATURE_FIELDS.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!addFieldId}
                            onClick={() => {
                              if (!addFieldId) return
                              addFieldFromDefaults(addFieldId)
                              setAddFieldId("")
                              setEditMode("fields")
                            }}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-50"
                          >
                            Aggiungi
                          </button>
                        </span>
                      )
                  : slotsDraft
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedSlotId(s.id)}
                          className={`rounded px-2 py-1 ${
                            selectedSlotId === s.id ? "bg-amber-500 text-zinc-950" : "border border-zinc-700 text-zinc-200"
                          }`}
                        >
                          {s.order}. {s.label}
                        </button>
                      ))}
                <div className="ml-auto flex items-center gap-2">
                  <label className="text-zinc-400">Pagina</label>
                  <select
                    value={previewPage}
                    onChange={(e) => setPreviewPage(Number(e.target.value))}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
                  >
                    {Array.from({ length: Math.max(1, pageCount) }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {previewErr && <p className="mb-2 text-xs text-red-400">{previewErr}</p>}
              <div className="overflow-auto rounded border border-zinc-800 bg-zinc-900 p-2">
                <canvas ref={canvasRef} onClick={onCanvasClick} className="mx-auto cursor-crosshair rounded bg-white" />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {previewLoading ? "Carico anteprima PDF..." : "Suggerimento: scegli uno slot e clicca nel punto firma."}
              </p>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addNextDefaultSlot}
                disabled={slotsDraft.length >= DEFAULT_SIGNATURE_SLOTS.length}
                className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 disabled:opacity-40"
              >
                Aggiungi slot (da elenco predefinito)
              </button>
              <button
                type="button"
                onClick={addCustomSlot}
                className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200"
              >
                Aggiungi slot (personalizzato)
              </button>
              <button type="button" onClick={resetFiveDefaults} className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200">
                Ripristina 5 slot predefiniti
              </button>
              <button type="button" onClick={resetDefaultFields} className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200">
                Ripristina campi predefiniti
              </button>
            </div>

            <div className="mt-3 grid gap-2">
              {slotsDraft
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((s) => (
                  <div key={s.id} className="flex flex-col gap-2 rounded border border-zinc-700 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-medium text-zinc-200">{s.label}</div>
                      <button
                        type="button"
                        title="Rimuovi questo step di firma"
                        disabled={slotsDraft.length <= 1}
                        onClick={() => removeSlot(s.id)}
                        className="rounded border border-red-900/60 px-2 py-1 text-xs text-red-300 disabled:opacity-40"
                      >
                        Rimuovi
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                    <input
                      type="number"
                      min={1}
                      title="Pagina"
                      value={s.page}
                      onChange={(e) => updateSlot(s.id, { page: Number(e.target.value || 1) })}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                      placeholder="Pagina"
                    />
                    <input
                      type="number"
                      title="X"
                      value={s.x}
                      onChange={(e) => updateSlot(s.id, { x: Number(e.target.value || 0) })}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                      placeholder="X"
                    />
                    <input
                      type="number"
                      title="Y"
                      value={s.y}
                      onChange={(e) => updateSlot(s.id, { y: Number(e.target.value || 0) })}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                      placeholder="Y"
                    />
                    <input
                      type="number"
                      min={40}
                      title="Larghezza"
                      value={s.width}
                      onChange={(e) => updateSlot(s.id, { width: Number(e.target.value || 40) })}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                      placeholder="Larghezza"
                    />
                    <input
                      type="number"
                      min={20}
                      title="Altezza"
                      value={s.height}
                      onChange={(e) => updateSlot(s.id, { height: Number(e.target.value || 20) })}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                      placeholder="Altezza"
                    />
                    </div>
                  </div>
                ))}
            </div>

            <div className="mt-4 rounded border border-emerald-700/40 bg-emerald-950/10 p-3">
              <h3 className="text-xs font-semibold text-emerald-200">Campi precompilazione (testo)</h3>
              <p className="mt-1 text-xs text-zinc-500">Questi valori vengono scritti sul PDF (prima della firma) usando i dati della cassa.</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Aggiungi campo (predefinito)
                  <select
                    value={addFieldId}
                    onChange={(e) => setAddFieldId(e.target.value)}
                    className="min-w-[220px] rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
                  >
                    <option value="">Seleziona…</option>
                    {DEFAULT_SIGNATURE_FIELDS.filter((d) => !fieldsDraft.some((f) => f.id === d.id)).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label} (id: {d.id})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!addFieldId}
                  onClick={() => {
                    if (!addFieldId) return
                    addFieldFromDefaults(addFieldId)
                    setAddFieldId("")
                  }}
                  className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-50"
                >
                  Aggiungi
                </button>
                <button
                  type="button"
                  onClick={clearAllFields}
                  className="rounded border border-red-900/60 px-3 py-2 text-sm text-red-200 hover:bg-red-950/20"
                  title="Rimuove tutti i campi: verranno usati solo quelli che aggiungi manualmente."
                >
                  Svuota campi
                </button>
                <span className="text-xs text-zinc-500">
                  Suggeriti: <span className="text-zinc-300">legale_rappresentante</span> (tutore), <span className="text-zinc-300">data_oggi</span>, <span className="text-zinc-300">nome</span>, <span className="text-zinc-300">cognome</span>.
                </span>
              </div>
              <div className="mt-3 grid gap-2">
                {fieldsDraft
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((f) => (
                    <div key={f.id} className="grid gap-2 rounded border border-zinc-700 p-2 md:grid-cols-7">
                      <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                        <input
                          type="text"
                          value={f.label}
                          onChange={(e) => updateField(f.id, { label: e.target.value })}
                          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                          title="Etichetta (solo display). L'id tecnico resta quello."
                        />
                        <button
                          type="button"
                          onClick={() => removeField(f.id)}
                          className="rounded border border-red-900/60 px-2 py-1 text-[11px] text-red-200 hover:bg-red-950/20"
                          title="Rimuovi campo"
                        >
                          Rimuovi
                        </button>
                      </div>
                      <input
                        type="number"
                        min={1}
                        title="Pagina"
                        value={f.page}
                        onChange={(e) => updateField(f.id, { page: Number(e.target.value || 1) })}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                        placeholder="Pagina"
                      />
                      <input
                        type="number"
                        title="X"
                        value={f.x}
                        onChange={(e) => updateField(f.id, { x: Number(e.target.value || 0) })}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                        placeholder="X"
                      />
                      <input
                        type="number"
                        title="Y"
                        value={f.y}
                        onChange={(e) => updateField(f.id, { y: Number(e.target.value || 0) })}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                        placeholder="Y"
                      />
                      <input
                        type="number"
                        title="Size"
                        value={f.size ?? 10}
                        onChange={(e) => updateField(f.id, { size: Number(e.target.value || 10) })}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                        placeholder="Size"
                      />
                      <input
                        type="number"
                        title="MaxWidth"
                        value={f.maxWidth ?? ""}
                        onChange={(e) => updateField(f.id, { maxWidth: e.target.value === "" ? undefined : Number(e.target.value) })}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                        placeholder="MaxW"
                      />
                      <div className="flex items-center justify-end text-xs text-zinc-500">id: {f.id}</div>
                    </div>
                  ))}
              </div>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={onSaveTemplateLayout}
                disabled={slotsBusy || slotsDraft.length === 0}
                className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
              >
                {slotsBusy ? "Salvataggio..." : "Salva posizioni sul template"}
              </button>
              <button
                type="button"
                onClick={() => (editMode === "fields" ? duplicateFieldsFromPage1To(previewPage) : duplicateSlotsFromPage1To(previewPage))}
                disabled={!templateId || previewPage <= 1}
                className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                title="Duplica tutti i puntamenti della pagina 1 sulla pagina corrente"
              >
                Duplica puntatori pag. 1 → pag. {previewPage}
              </button>
              <button
                type="button"
                onClick={onReplaceLastPagePrivacy}
                disabled={!templateId}
                className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                title="Aggiorna solo l’ultima pagina del PDF template"
              >
                Sostituisci ultima pagina (Privacy)
              </button>
              <button
                type="button"
                onClick={onAppendPrivacyPage}
                disabled={!templateId}
                className="ml-2 rounded border border-emerald-700/60 bg-emerald-950/20 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-950/30 disabled:opacity-50"
                title="Aggiunge una nuova pagina Privacy in fondo (utile per template da 1 pagina, es. ASI)"
              >
                Aggiungi pagina Privacy (in coda)
              </button>
              <span className="ml-2 inline-flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  placeholder="Pag."
                  value={deletePageNum}
                  onChange={(e) => setDeletePageNum(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
                  title="Pagina da cancellare (vuoto = ultima)"
                />
                <button
                  type="button"
                  onClick={onDeleteTemplatePage}
                  disabled={!templateId}
                  className="rounded border border-red-700/60 bg-red-950/20 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-950/30 disabled:opacity-50"
                  title="Cancella una pagina dal PDF del template"
                >
                  Cancella pagina
                </button>
              </span>
            </div>
          </>
        )}
      </div>
      )}

      <form onSubmit={onCreate} className="mt-6 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-4">
        {isAdmin && (
          <label className="flex items-center gap-2 text-xs text-zinc-400 md:col-span-4">
            <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
            Usa template esistente (consigliato)
          </label>
        )}
        {useTemplate && (
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 md:col-span-4"
          >
            <option value="">Seleziona template...</option>
            {(templatesQ.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.originalName})
              </option>
            ))}
          </select>
        )}
        <input
          type="email"
          placeholder="Email cliente"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          required
        />
        <input
          type="text"
          placeholder="Nome cliente (opz.)"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
        {isAdmin && !useTemplate ? (
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"
            required
          />
        ) : (
          <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-500">PDF dal template selezionato</div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
        >
          {busy ? "Invio..." : "Crea e invia"}
        </button>
      </form>
      {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="grid gap-3 sm:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Da (data creazione)
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value)
                setPage(1)
              }}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            A (data creazione)
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value)
                setPage(1)
              }}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Consulente (username)
            <input
              type="text"
              value={consultant}
              onChange={(e) => {
                setConsultant(e.target.value)
                setPage(1)
              }}
              placeholder={isAdmin ? "es. mario" : "(auto)"}
              disabled={!isAdmin}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Righe/pagina
            <select
              value={String(limit)}
              onChange={(e) => {
                setLimit(Number(e.target.value) || 50)
                setPage(1)
              }}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => {
                setFromDate("")
                setToDate("")
                setConsultant("")
                setPage(1)
              }}
              className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-200"
            >
              Reset filtri
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <div>
            Totale: {listQ.data?.total ?? 0} — Pagina {listQ.data?.page ?? page}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={(listQ.data?.page ?? page) <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={(listQ.data?.page ?? page) * (listQ.data?.limit ?? limit) >= (listQ.data?.total ?? 0)}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="px-3 py-2 text-left font-medium">Creato</th>
              <th className="px-3 py-2 text-left font-medium">Cliente</th>
              <th className="px-3 py-2 text-left font-medium">Documento</th>
              <th className="px-3 py-2 text-left font-medium">Stato</th>
              <th className="px-3 py-2 text-left font-medium">Scadenza</th>
              <th className="px-3 py-2 text-left font-medium">Link</th>
              <th className="px-3 py-2 text-left font-medium">Azioni</th>
            </tr>
          </thead>
          <tbody className="text-zinc-200">
            {(listQ.data?.rows ?? []).map((r) => {
              const link = `${window.location.origin}/firma/${r.token}`
              return (
                <tr key={r.id} className="border-b border-zinc-800/70 last:border-b-0">
                  <td className="px-3 py-2">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div>{r.customerName || "—"}</div>
                    <div className="text-xs text-zinc-500">{r.customerEmail}</div>
                    {isAdmin && r.createdByUsername && <div className="text-[11px] text-zinc-600">Consulente: {r.createdByUsername}</div>}
                  </td>
                  <td className="px-3 py-2">{r.documentOriginalName}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">{fmtDate(r.expiresAt)}</td>
                  <td className="px-3 py-2">
                    <a className="text-amber-400 hover:underline" href={link} target="_blank" rel="noreferrer">
                      Apri
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={async () => {
                          try {
                            setErr(null)
                            setMsg(null)
                            setDeletingId(r.id)
                            const blob = await signaturesApi.exportAuditCsv({ id: r.id })
                            const url = URL.createObjectURL(blob)
                            const el = globalThis.document.createElement("a")
                            el.href = url
                            el.download = `firma-audit-${r.id}-${new Date().toISOString().slice(0, 10)}.csv`
                            el.click()
                            URL.revokeObjectURL(url)
                            setMsg("Audit PDF esportato (CSV).")
                          } catch (e2) {
                            setErr((e2 as Error).message)
                          } finally {
                            setDeletingId(null)
                          }
                        }}
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800/40 disabled:opacity-60"
                        title="Scarica audit (CSV) solo per questo PDF/richiesta"
                      >
                        Audit CSV
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={() => onDelete(r.id, false)}
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800/40 disabled:opacity-60"
                        title="Elimina solo la riga. Il PDF resta sul server."
                      >
                        {deletingId === r.id ? "Elimino..." : "Elimina (solo app)"}
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={() => onDelete(r.id, true)}
                        className="rounded border border-red-900/70 px-2 py-1 text-xs text-red-300 hover:bg-red-900/20 disabled:opacity-60"
                        title="Elimina riga e cancella anche i file PDF."
                      >
                        {deletingId === r.id ? "Elimino..." : "Elimina + file"}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!listQ.isLoading && (listQ.data?.rows ?? []).length === 0 && (
              <tr>
                <td className="px-3 py-3 text-zinc-500" colSpan={7}>
                  Nessuna richiesta firma.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

