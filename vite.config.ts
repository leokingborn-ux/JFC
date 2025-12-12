import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ensure production builds use relative asset paths so Electron can load them via file://
export default defineConfig({
  base: './',
  plugins: [react()],
})
