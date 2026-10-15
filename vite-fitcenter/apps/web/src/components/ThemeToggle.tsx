import { useTheme } from "@/components/theme-provider"

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme()
  const dark = theme !== "light"

  return (
    <div className={compact ? "flex gap-1" : "mt-2 flex gap-1"} role="group" aria-label="Sfondo schermata">
      {!compact && <p className="mb-1 w-full text-xs text-zinc-500">Sfondo</p>}
      <button
        type="button"
        onClick={() => setTheme("dark")}
        className={`flex-1 rounded border px-2 py-1.5 text-xs transition-colors ${
          dark
            ? "border-amber-500/50 bg-zinc-800 text-zinc-100"
            : "border-zinc-600 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
        aria-pressed={dark}
      >
        Nero
      </button>
      <button
        type="button"
        onClick={() => setTheme("light")}
        className={`flex-1 rounded border px-2 py-1.5 text-xs transition-colors ${
          !dark
            ? "border-amber-500/50 bg-white text-zinc-900"
            : "border-zinc-600 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
        aria-pressed={!dark}
      >
        Bianco
      </button>
    </div>
  )
}
