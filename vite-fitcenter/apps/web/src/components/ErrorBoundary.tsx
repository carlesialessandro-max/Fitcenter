import { Component, type ErrorInfo, type ReactNode } from "react"

type Props = { children: ReactNode }
type State = { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary:", error, errorInfo)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="min-h-svh bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6">
          <h1 className="text-xl font-semibold text-amber-400">Errore nell&apos;app</h1>
          <p className="mt-2 text-sm text-zinc-400 max-w-md text-center">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-6 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400"
          >
            Riprova
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
