import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { authApi, type LoginResponse } from "@/api/auth"

export function Login() {
  const navigate = useNavigate()
  const { applySession } = useAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [otpCode, setOtpCode] = useState("")
  const [otpUsername, setOtpUsername] = useState("")
  const [emailHint, setEmailHint] = useState("")
  const [step, setStep] = useState<"password" | "otp">("password")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await authApi.login(username, password)
      if ("needsOtp" in res && res.needsOtp) {
        setStep("otp")
        setOtpUsername(res.username)
        setEmailHint(res.emailHint)
        setOtpCode("")
        return
      }
      const ok = res as LoginResponse
      applySession(ok.token, ok.user)
      navigate("/", { replace: true })
    } catch (err) {
      setError((err as Error).message ?? "Accesso non riuscito")
    } finally {
      setLoading(false)
    }
  }

  async function handleOtp(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await authApi.loginOtp(otpUsername, otpCode)
      applySession(res.token, res.user)
      navigate("/", { replace: true })
    } catch (err) {
      setError((err as Error).message ?? "Codice non valido")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl">
        <div className="mb-6 text-center">
          <span className="text-2xl font-semibold tracking-tight text-amber-400">FitCenter</span>
          <p className="mt-1 text-sm text-zinc-500">Accesso area gestione</p>
        </div>

        {step === "password" ? (
          <form onSubmit={handlePassword} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs font-medium text-zinc-400">
                Utente
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                placeholder="es. admin / carmen"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-zinc-400">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
              />
            </div>
            {error && (
              <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-amber-500 py-2.5 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {loading ? "Accesso in corso..." : "Accedi"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtp} className="space-y-4">
            <p className="text-sm text-zinc-400">
              Abbiamo inviato un codice a 6 cifre a <span className="font-medium text-zinc-200">{emailHint}</span>.
            </p>
            <div>
              <label htmlFor="otp" className="block text-xs font-medium text-zinc-400">
                Codice
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                required
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg tracking-[0.3em] text-zinc-100 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                placeholder="000000"
              />
            </div>
            {error && (
              <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || otpCode.length !== 6}
              className="w-full rounded-lg bg-amber-500 py-2.5 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {loading ? "Verifica..." : "Conferma"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("password")
                setOtpCode("")
                setError("")
              }}
              className="w-full text-sm text-zinc-500 hover:text-zinc-300"
            >
              Torna indietro
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
