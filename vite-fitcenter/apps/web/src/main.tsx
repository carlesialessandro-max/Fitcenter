import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@workspace/ui/globals.css"
import { App } from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { ConsulenteProvider } from "@/contexts/ConsulenteContext"
import { ErrorBoundary } from "@/components/ErrorBoundary"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ConsulenteProvider>
          <App />
        </ConsulenteProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
)
