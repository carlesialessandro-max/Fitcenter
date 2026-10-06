import { useEffect, useState } from "react"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function PwaInstallHint() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIos, setShowIos] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("fitcenter-pwa-dismiss") === "1"
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (isStandalone()) return
    if (isIos()) setShowIos(true)
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    return () => window.removeEventListener("beforeinstallprompt", onPrompt)
  }, [])

  if (dismissed || isStandalone()) return null
  if (!promptEvent && !showIos) return null

  function dismiss() {
    try {
      localStorage.setItem("fitcenter-pwa-dismiss", "1")
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  async function install() {
    if (!promptEvent) return
    await promptEvent.prompt()
    setPromptEvent(null)
  }

  return (
    <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 rounded-xl border border-zinc-700 bg-zinc-900/95 p-3 text-sm text-zinc-200 shadow-xl backdrop-blur sm:left-auto sm:right-4 sm:max-w-sm">
      <p className="pr-6 font-medium text-zinc-100">Usa FitCenter come app</p>
      {promptEvent ? (
        <p className="mt-1 text-xs text-zinc-400">Si installa sulla schermata Home, senza App Store.</p>
      ) : (
        <p className="mt-1 text-xs text-zinc-400">
          Su iPhone: tocca Condividi e poi <span className="text-zinc-200">Aggiungi a Home</span>.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {promptEvent ? (
          <button
            type="button"
            onClick={() => void install()}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-400"
          >
            Installa
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Chiudi
        </button>
      </div>
    </div>
  )
}
