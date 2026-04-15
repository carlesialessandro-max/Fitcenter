import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Questa è solo una warning di Vite (non un errore). La alziamo per evitare rumore in CI.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react"
          if (id.includes("/react-router-dom/") || id.includes("/react-router/")) return "vendor-router"
          if (id.includes("/@tanstack/")) return "vendor-query"
          if (id.includes("/recharts/") || id.includes("/d3-")) return "vendor-charts"
          if (id.includes("/pdfjs-dist/")) return "vendor-pdfjs"
          if (id.includes("/jspdf") || id.includes("/jspdf-autotable/")) return "vendor-jspdf"
          if (id.includes("/@workspace/ui/")) return "vendor-ui"
          if (id.includes("/@floating-ui/") || id.includes("/radix-ui/") || id.includes("/@radix-ui/")) return "vendor-ui2"
          return "vendor"
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
})
