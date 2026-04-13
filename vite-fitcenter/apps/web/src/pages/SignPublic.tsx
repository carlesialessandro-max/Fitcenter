import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { signaturesApi } from "@/api/signatures"
import type { SignaturePublicInfo } from "@/types/signature"

export function SignPublicPage() {
  const { token = "" } = useParams()
  const signerStorageKey = `fitcenter-signer-token:${token}`
  const [info, setInfo] = useState<SignaturePublicInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [otp, setOtp] = useState("")
  const [debugOtp, setDebugOtp] = useState<string | undefined>()
  const [signerToken, setSignerToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(signerStorageKey)
    } catch {
      return null
    }
  })
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [signatureMode, setSignatureMode] = useState<"draw" | "typed" | "tablet">("draw")
  const [drawing, setDrawing] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const [tabletReady, setTabletReady] = useState<boolean | null>(null)
  const [tabletBusy, setTabletBusy] = useState(false)
  const [tabletSignatureDataUrl, setTabletSignatureDataUrl] = useState<string | null>(null)
  const [fullName, setFullName] = useState("")
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)
  const lastMidRef = useRef<{ x: number; y: number } | null>(null)
  const activePointerIdRef = useRef<number | null>(null)

  const fullNameTrimmed = fullName.trim()
  const signatureReady =
    signatureMode === "typed"
      ? !!typedSignatureDataUrl
      : signatureMode === "tablet"
        ? !!tabletSignatureDataUrl
        : hasInk

  const missing: string[] = []
  if (!acceptedTerms) missing.push("Accetta i termini")
  if (!fullNameTrimmed) missing.push("Inserisci nome e cognome")
  if (!signerToken) missing.push("Verifica OTP")
  if (!signatureReady) missing.push("Inserisci la firma")

  const canSign =
    !!signerToken &&
    acceptedTerms &&
    !!fullNameTrimmed &&
    (signatureMode === "typed" || (signatureMode === "draw" && hasInk) || (signatureMode === "tablet" && !!tabletSignatureDataUrl))

  async function loadSigCaptX(): Promise<void> {
    if ((globalThis as any).WacomGSS_SignatureSDK) return
    await new Promise<void>((resolve, reject) => {
      const existing = globalThis.document.querySelector<HTMLScriptElement>('script[data-wacom-sigcaptx="1"]')
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true })
        existing.addEventListener("error", () => reject(new Error("Impossibile caricare SigCaptX")), { once: true })
        return
      }
      const s = globalThis.document.createElement("script")
      s.src = "/wacom-sigcaptx/wgssSigCaptX.js"
      s.async = true
      s.dataset.wacomSigcaptx = "1"
      s.onload = () => resolve()
      s.onerror = () => reject(new Error("Impossibile caricare SigCaptX"))
      globalThis.document.head.appendChild(s)
    })
  }

  async function probeSigCaptX(): Promise<boolean> {
    try {
      await loadSigCaptX()
      // inizializza un'istanza e aspetta un attimo che setti .running
      const sdk = new (globalThis as any).WacomGSS_SignatureSDK(() => {}, 8000)
      const deadline = Date.now() + 3_000
      while (Date.now() < deadline) {
        if (sdk?.running) return true
        await new Promise((r) => setTimeout(r, 250))
      }
      return !!sdk?.running
    } catch {
      return false
    }
  }

  async function captureFromTablet(): Promise<string> {
    await loadSigCaptX()
    const WacomGSS_SignatureSDK = (globalThis as any).WacomGSS_SignatureSDK as any
    const sdk = new WacomGSS_SignatureSDK(() => {}, 8000)
    const licence = String((import.meta as any).env?.VITE_WACOM_SIGCAPTX_LICENCE ?? "").trim()

    // attesa inizializzazione (su PC lenti può richiedere qualche secondo)
    {
      const deadline = Date.now() + 3_000
      while (Date.now() < deadline && !sdk.running) {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    if (!sdk.running) {
      throw new Error(
        "SigCaptX non disponibile su questa postazione. Verifica installazione e apri https://localhost:8000 (e se serve https://localhost:8001) in Chrome (accetta certificato)."
      )
    }

    const sigCtl = await new Promise<any>((resolve, reject) => {
      const o = new sdk.SigCtl((sigCtlV: any, status: number) => {
        if (status === sdk.ResponseStatus.OK) resolve(sigCtlV)
        else reject(new Error(`SigCtl error: ${status}`))
      })
      void o
    })

    const dynCapt = await new Promise<any>((resolve, reject) => {
      const o = new sdk.DynamicCapture((dynV: any, status: number) => {
        if (status === sdk.ResponseStatus.OK) resolve(dynV)
        else reject(new Error(`DynamicCapture error: ${status}`))
      })
      void o
    })

    // Se disponibile, applica la licenza Wacom (necessaria per alcuni setup: DynCaptNotLicensed).
    if (licence) {
      await new Promise<void>((resolve, reject) => {
        sigCtl.PutLicence(licence, (_sigCtlV: any, status: number) => {
          if (status === sdk.ResponseStatus.OK) resolve()
          else reject(new Error(`PutLicence (SigCtl) error: ${status}`))
        })
      })
      await new Promise<void>((resolve, reject) => {
        dynCapt.PutLicence(licence, (_dynV: any, status: number) => {
          if (status === sdk.ResponseStatus.OK) resolve()
          else reject(new Error(`PutLicence (DynamicCapture) error: ${status}`))
        })
      })
    }

    const sigObj = await new Promise<any>((resolve, reject) => {
      dynCapt.Capture(sigCtl, fullNameTrimmed, "Firma documento", null, null, (_dynV: any, sigObjV: any, status: number) => {
        if (status === sdk.DynamicCaptureResult.DynCaptOK) return resolve(sigObjV)
        if (status === sdk.DynamicCaptureResult.DynCaptCancel) return reject(new Error("Firma annullata"))
        if (status === sdk.DynamicCaptureResult.DynCaptPadError) return reject(new Error("Nessun servizio di cattura disponibile"))
        if (status === sdk.DynamicCaptureResult.DynCaptNotLicensed) {
          return reject(
            new Error(
              licence
                ? "Licenza Signature Capture non valida (chiave presente ma rifiutata)."
                : "Licenza Signature Capture non valida. Imposta `VITE_WACOM_SIGCAPTX_LICENCE` nella .env del web (chiave Wacom)."
            )
          )
        }
        return reject(new Error(`Errore firma (${status})`))
      })
    })

    const base64 = await new Promise<string>((resolve, reject) => {
      const outputFlags = sdk.RBFlags.RenderOutputBase64 | sdk.RBFlags.RenderColor32BPP
      sigObj.RenderBitmap(
        "image/png",
        760,
        220,
        2,
        "0R 0G 0B",
        "1R 1G 1B",
        outputFlags,
        10,
        10,
        (_sigObjV: any, bmpObj: any, status: number) => {
          if (status === sdk.ResponseStatus.OK) resolve(String(bmpObj))
          else reject(new Error(`RenderBitmap error: ${status}`))
        }
      )
    })

    return `data:image/png;base64,${base64}`
  }

  useEffect(() => {
    let mounted = true
    signaturesApi
      .getPublicInfo(token)
      .then((d) => {
        if (!mounted) return
        setInfo(d)
        if (!fullNameTrimmed && d.customerName?.trim()) setFullName(d.customerName.trim())
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false))
    return () => {
      mounted = false
    }
  }, [token, fullNameTrimmed])

  useEffect(() => {
    try {
      if (signerToken) sessionStorage.setItem(signerStorageKey, signerToken)
      else sessionStorage.removeItem(signerStorageKey)
    } catch {
      // ignore storage errors
    }
  }, [signerStorageKey, signerToken])

  function getCtx() {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    return { canvas, ctx }
  }

  function pointerToCanvas(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function beginStroke(p: { x: number; y: number }) {
    const out = getCtx()
    if (!out) return
    const { ctx } = out
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#111827"
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    lastPtRef.current = p
    lastMidRef.current = p
  }

  function extendStroke(p: { x: number; y: number }) {
    const out = getCtx()
    if (!out) return
    const { ctx } = out
    const prev = lastPtRef.current
    const lastMid = lastMidRef.current
    if (!prev || !lastMid) {
      lastPtRef.current = p
      lastMidRef.current = p
      return
    }
    const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 }
    ctx.beginPath()
    ctx.moveTo(lastMid.x, lastMid.y)
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y)
    ctx.stroke()
    lastPtRef.current = p
    lastMidRef.current = mid
  }

  function endStroke() {
    setDrawing(false)
    activePointerIdRef.current = null
    lastPtRef.current = null
    lastMidRef.current = null
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    // Manteniamo il canvas trasparente: nel PDF verra' disegnato solo il tratto firma.
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Hi-DPI: scala il canvas in base al DPR.
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    const targetW = Math.round(rect.width * dpr)
    const targetH = Math.round(rect.height * dpr)
    if (canvas.width !== targetW) canvas.width = targetW
    if (canvas.height !== targetH) canvas.height = targetH
    clearCanvas()
  }, [])

  // Fallback: alcuni setup Wacom/Windows Ink non inviano correttamente gli eventi React su canvas.
  // Agganciamo anche listener nativi (con passive=false) per garantire il tratto.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onDown = (e: PointerEvent) => {
      if (signatureMode !== "draw") return
      try { e.preventDefault() } catch {}
      if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return
      activePointerIdRef.current = e.pointerId
      try { canvas.setPointerCapture(e.pointerId) } catch {}
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const p = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
      setDrawing(true)
      setHasInk(true)
      beginStroke(p)
    }

    const onMove = (e: PointerEvent) => {
      if (signatureMode !== "draw") return
      if (!drawing) return
      if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return
      try { e.preventDefault() } catch {}
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const p = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
      extendStroke(p)
    }

    const onUp = (e: PointerEvent) => {
      if (signatureMode !== "draw") return
      if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return
      try { e.preventDefault() } catch {}
      endStroke()
    }

    canvas.addEventListener("pointerdown", onDown, { passive: false })
    canvas.addEventListener("pointermove", onMove, { passive: false })
    // Raw updates: alcune penne preferiscono questo canale.
    canvas.addEventListener("pointerrawupdate", onMove as any, { passive: false } as any)
    canvas.addEventListener("pointerup", onUp, { passive: false })
    canvas.addEventListener("pointercancel", onUp, { passive: false })

    return () => {
      canvas.removeEventListener("pointerdown", onDown as any)
      canvas.removeEventListener("pointermove", onMove as any)
      canvas.removeEventListener("pointerrawupdate", onMove as any)
      canvas.removeEventListener("pointerup", onUp as any)
      canvas.removeEventListener("pointercancel", onUp as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureMode, drawing])

  const typedSignatureDataUrl = useMemo(() => {
    if (!fullNameTrimmed) return null
    // In modalità "typed" la canvas può non essere montata: usiamo un canvas offscreen fisso.
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    const width = Math.round(760 * dpr)
    const height = Math.round(220 * dpr)
    const off = document.createElement("canvas")
    off.width = width
    off.height = height
    const ctx = off.getContext("2d")
    if (!ctx) return null
    ctx.clearRect(0, 0, off.width, off.height)
    const fontSize = Math.round(Math.min(off.height * 0.55, off.width / Math.max(8, fullNameTrimmed.length) * 1.8))
    ctx.fillStyle = "#111827"
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    ctx.font = `${fontSize}px "Segoe Script","Brush Script MT",cursive`
    ctx.fillText(fullNameTrimmed, off.width / 2, off.height / 2)
    return off.toDataURL("image/png")
  }, [fullNameTrimmed])

  async function onRequestOtp() {
    try {
      setErr(null)
      setOk(null)
      const out = await signaturesApi.requestOtp(token)
      setDebugOtp(out.debugOtp)
      setOk("OTP inviato via email.")
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function onVerifyOtp() {
    try {
      setErr(null)
      setOk(null)
      const out = await signaturesApi.verifyOtp(token, otp)
      setSignerToken(out.signerToken)
      setOtp("")
      setOk("OTP verificato. Ora puoi firmare.")
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function onSign() {
    try {
      if (!signerToken) return setErr("Verifica OTP prima di firmare")
      if (!acceptedTerms) return setErr("Devi accettare i termini")
      if (!fullNameTrimmed) return setErr("Inserisci nome e cognome")
      const dataUrl =
        signatureMode === "typed"
          ? typedSignatureDataUrl
          : signatureMode === "tablet"
            ? tabletSignatureDataUrl
            : canvasRef.current?.toDataURL("image/png")
      if (!dataUrl || (signatureMode === "draw" && !hasInk) || (signatureMode === "tablet" && !tabletSignatureDataUrl)) return setErr("Firma mancante")
      setErr(null)
      setOk(null)
      const out = await signaturesApi.sign(token, signerToken, dataUrl, fullNameTrimmed, info?.nextStepId ?? undefined)
      setOk(out.completed ? "Firma completata." : `Firma salvata. Prossimo step: ${out.nextStepLabel ?? "successivo"}.`)
      clearCanvas()
      setTabletSignatureDataUrl(null)
      if (out.completed) setSignerToken(null)
      const refreshed = await signaturesApi.getPublicInfo(token)
      setInfo(refreshed)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  if (loading) return <div className="p-6 text-zinc-500">Caricamento...</div>
  if (!info) return <div className="p-6 text-red-400">{err ?? "Link non valido"}</div>

  return (
    <div className="min-h-svh bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h1 className="text-2xl font-semibold">Firma documento</h1>
        <p className="mt-1 text-sm text-zinc-500">{info.documentOriginalName}</p>
        <p className="mt-1 text-xs text-zinc-500">Email: {info.customerEmailMasked}</p>
        {info.customerName && <p className="text-xs text-zinc-500">Nominativo: {info.customerName}</p>}
        <p className="text-xs text-zinc-500">Stato: {info.status}</p>
        {info.status === "pending" && (
          <p className="text-xs text-zinc-500">
            Step: {info.signedSteps ?? 0}/{info.totalSteps ?? 0}
            {info.nextStepLabel ? ` - Prossima firma: ${info.nextStepLabel}` : ""}
          </p>
        )}
        {info.status === "signed" && <p className="mt-2 text-emerald-400">Documento già firmato.</p>}
        {info.status === "expired" && <p className="mt-2 text-red-400">Link scaduto.</p>}

        <div className="mt-4">
          <a
            href={signaturesApi.publicDocumentUrl(token)}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-amber-400 hover:underline"
          >
            {info.status === "signed" ? "Apri / scarica documento firmato" : "Apri documento PDF"}
          </a>
        </div>

        {info.status === "pending" && (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-zinc-400">
                Nome e cognome
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Es. Mario Rossi"
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="flex items-center gap-2 self-end text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="h-4 w-4 accent-amber-500"
                />
                <span>
                  Accetto i termini (
                  <Link to="/informativa" target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">
                    leggi informativa privacy
                  </Link>
                  )
                </span>
              </label>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="OTP 6 cifre"
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              />
              <div className="flex gap-2 sm:col-span-2">
                <button type="button" onClick={onRequestOtp} className="rounded bg-zinc-700 px-3 py-2 text-sm">
                  Richiedi OTP
                </button>
                <button type="button" onClick={onVerifyOtp} className="rounded bg-amber-500 px-3 py-2 text-sm text-zinc-900">
                  Verifica
                </button>
                {signerToken ? (
                  <span className="self-center text-xs font-medium text-emerald-400">OTP verificato</span>
                ) : null}
              </div>
            </div>
            {debugOtp && <p className="mt-2 text-xs text-zinc-500">Debug OTP (dev): {debugOtp}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSignatureMode("draw")}
                className={`rounded border px-3 py-2 text-sm ${
                  signatureMode === "draw"
                    ? "border-amber-500 bg-amber-500/20 text-amber-400"
                    : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                Disegna firma
              </button>
              <button
                type="button"
                onClick={() => setSignatureMode("typed")}
                className={`rounded border px-3 py-2 text-sm ${
                  signatureMode === "typed"
                    ? "border-amber-500 bg-amber-500/20 text-amber-400"
                    : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                Firma digitata
              </button>
              <button
                type="button"
                onClick={async () => {
                  setSignatureMode("tablet")
                  setErr(null)
                  const ok = await probeSigCaptX()
                  setTabletReady(ok)
                }}
                className={`rounded border px-3 py-2 text-sm ${
                  signatureMode === "tablet"
                    ? "border-amber-500 bg-amber-500/20 text-amber-400"
                    : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                Tavoletta (Wacom)
              </button>
              {signatureMode === "draw" && (
                <p className="text-xs text-zinc-500">Supporta mouse, dito e penna (Wacom).</p>
              )}
              {signatureMode === "tablet" && (
                <p className="text-xs text-zinc-500">
                  Richiede SigCaptX installato sulla postazione (default <span className="font-mono">https://localhost:8000</span>).
                </p>
              )}
            </div>

            {signatureMode === "draw" ? (
              <div className="mt-3 rounded border border-zinc-700 bg-white p-2">
                <canvas
                  ref={canvasRef}
                  width={760}
                  height={220}
                  className="h-[220px] w-full cursor-crosshair rounded bg-white"
                  style={{ touchAction: "none" }}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return
                    activePointerIdRef.current = e.pointerId
                    e.currentTarget.setPointerCapture(e.pointerId)
                    const p = pointerToCanvas(e)
                    if (!p) return
                    setDrawing(true)
                    setHasInk(true)
                    beginStroke(p)
                  }}
                  onPointerMove={(e) => {
                    if (!drawing) return
                    if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return
                    e.preventDefault()
                    const p = pointerToCanvas(e)
                    if (!p) return
                    extendStroke(p)
                  }}
                  onPointerUp={(e) => {
                    if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return
                    e.preventDefault()
                    endStroke()
                  }}
                  onPointerCancel={(e) => {
                    if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return
                    e.preventDefault()
                    endStroke()
                  }}
                />
              </div>
            ) : signatureMode === "typed" ? (
              <div className="mt-3 rounded border border-zinc-700 bg-white p-6 text-center">
                <p className="text-sm text-zinc-500">Anteprima firma digitata</p>
                <p
                  className="mt-2 select-none text-4xl text-zinc-900"
                  style={{ fontFamily: '"Segoe Script","Brush Script MT",cursive' }}
                >
                  {fullNameTrimmed || "—"}
                </p>
              </div>
            ) : (
              <div className="mt-3 rounded border border-zinc-700 bg-zinc-950/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-zinc-300">
                    Stato SigCaptX:{" "}
                    {tabletReady == null ? (
                      <span className="text-zinc-500">non verificato</span>
                    ) : tabletReady ? (
                      <span className="text-emerald-400">pronto</span>
                    ) : (
                      <span className="text-red-400">non disponibile</span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={tabletBusy || !fullNameTrimmed}
                    onClick={async () => {
                      try {
                        setTabletBusy(true)
                        setErr(null)
                        const dataUrl = await captureFromTablet()
                        setTabletSignatureDataUrl(dataUrl)
                        setTabletReady(true)
                      } catch (e) {
                        // Non confondiamo "servizio non disponibile" con "licenza non valida".
                        // Se la cattura fallisce per licenza, il servizio è comunque pronto.
                        const msg = (e as Error).message ?? String(e)
                        setTabletReady(!/licenza/i.test(msg))
                        setTabletSignatureDataUrl(null)
                        setErr(msg)
                      } finally {
                        setTabletBusy(false)
                      }
                    }}
                    className="rounded bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-60"
                  >
                    {tabletBusy ? "Acquisizione..." : "Acquisisci firma"}
                  </button>
                </div>
                {!fullNameTrimmed && <p className="mt-2 text-xs text-zinc-500">Inserisci Nome e Cognome prima di acquisire.</p>}
                {tabletSignatureDataUrl && (
                  <div className="mt-3 rounded bg-white p-2">
                    <img alt="Firma" src={tabletSignatureDataUrl} className="h-[160px] w-full object-contain" />
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button type="button" onClick={clearCanvas} className="rounded border border-zinc-700 px-3 py-2 text-sm">
                Pulisci firma
              </button>
              <button
                type="button"
                onClick={onSign}
                disabled={!canSign}
                title={!canSign ? missing.join(" · ") : undefined}
                className="rounded bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-900"
              >
                Conferma firma {info.nextStepLabel ? `(${info.nextStepLabel})` : ""}
              </button>
            </div>
            {!canSign ? (
              <p className="mt-2 text-xs text-zinc-500">
                Per continuare: <span className="text-zinc-300">{missing.join(", ")}</span>
              </p>
            ) : null}
          </>
        )}

        {info.status === "signed" && (
          <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 p-3">
            <p className="text-sm text-emerald-300">Firma completata.</p>
            <p className="mt-1 text-xs text-emerald-400">Puoi aprire/scaricare il documento firmato dal link sopra.</p>
          </div>
        )}

        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
        {ok && <p className="mt-3 text-sm text-emerald-400">{ok}</p>}
      </div>
    </div>
  )
}

