import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Built for GitHub Pages at /spice-route-demo/ but works from any base.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  build: {
    // GitHub Pages serves this repo from main:/docs, so the build lands there.
    outDir: 'docs',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          pdf: ['pdfjs-dist'],
        },
      },
    },
  },
  server: { port: 5180, open: false },
})
