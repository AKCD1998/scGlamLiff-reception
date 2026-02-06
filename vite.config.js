import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'ghpages' ? '/scGlamLiff-reception/' : '/',
  // proxy api = เมื่อเราทำการเรียกใช้ /api จะถูกส่งไปที่ localhost:5050 แทน ไม่ใช่เวปที่ render โฮสต์
  server: { proxy: { '/api': 'http://localhost:5050' } },
}))
