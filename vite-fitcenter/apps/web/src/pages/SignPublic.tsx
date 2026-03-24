import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
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
  const [drawing, setDrawing] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let mounted = true
    signaturesApi
      .getPublicInfo(token)
      .then((d) => {
        if (!mounted) return
        setInfo(d)
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false))
    return () => {
      mounted = false
    }
  }, [token])

  useEffect(() => {
    try {
      if (signerToken) sessionStorage.setItem(signerStorageKey, signerToken)
      else sessionStorage.removeItem(signerStorageKey)
    } catch {
      // ignore storage errors
    }
  }, [signerStorageKey, signerToken])

  function canvasPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const p = canvasPos(e)
    if (!canvas || !p) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    setDrawing(true)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing) return
    const canvas = canvasRef.current
    const p = canvasPos(e)
    if (!canvas || !p) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.strokeStyle = "#111827"
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function onUp() {
    setDrawing(false)
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    // Manteniamo il canvas trasparente: nel PDF verra' disegnato solo il tratto firma.
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  useEffect(() => {
    clearCanvas()
  }, [])

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
      setOk("OTP verificato. Ora puoi firmare.")
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function onSign() {
    try {
      if (!signerToken) return setErr("Verifica OTP prima di firmare")
      const dataUrl = canvasRef.current?.toDataURL("image/png")
      if (!dataUrl) return setErr("Firma mancante")
      setErr(null)
      setOk(null)
      const out = await signaturesApi.sign(token, signerToken, dataUrl, info?.customerName || undefined, info?.nextStepId ?? undefined)
      setOk(out.completed ? "Firma completata." : `Firma salvata. Prossimo step: ${out.nextStepLabel ?? "successivo"}.`)
      clearCanvas()
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
              </div>
            </div>
            {debugOtp && <p className="mt-2 text-xs text-zinc-500">Debug OTP (dev): {debugOtp}</p>}

            <div className="mt-4 rounded border border-zinc-700 bg-white p-2">
              <canvas
                ref={canvasRef}
                width={760}
                height={220}
                className="h-[220px] w-full cursor-crosshair rounded bg-white"
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
                onMouseLeave={onUp}
              />
            </div>

            <div className="mt-3 flex gap-2">
              <button type="button" onClick={clearCanvas} className="rounded border border-zinc-700 px-3 py-2 text-sm">
                Pulisci firma
              </button>
              <button
                type="button"
                onClick={onSign}
                className="rounded bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-900"
              >
                Conferma firma {info.nextStepLabel ? `(${info.nextStepLabel})` : ""}
              </button>
            </div>
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

