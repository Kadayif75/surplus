import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// PDF.js resources are served locally in development and included in dist on Pages.
const pdfAssets = fileURLToPath(new URL('./public/pdfjs/', import.meta.url))
mkdirSync(pdfAssets, { recursive: true })
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE']) {
  cpSync(fileURLToPath(new URL(`./node_modules/pdfjs-dist/${name}`, import.meta.url)), `${pdfAssets}/${name}`, { recursive: true })
}

// https://vite.dev/config/
export default defineConfig({
  // Relatieve paden werken ook onder de repository-map van GitHub Pages.
  base: '/surplus/',
  plugins: [react()],
})
