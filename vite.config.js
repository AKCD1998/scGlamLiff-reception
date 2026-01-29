import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/scGlamLiff-reception/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5050',
    },
  },
}))
