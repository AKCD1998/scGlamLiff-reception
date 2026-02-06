import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${repoName()}/` : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5050',
    },
  },
}))

function repoName() {
  const ghRepo = process.env.GITHUB_REPOSITORY;
  if (ghRepo && ghRepo.includes('/')) {
    const [, name] = ghRepo.split('/');
    if (name) return name;
  }

  // TODO: replace if your repo name differs
  return 'scGlamLiff-reception';
}
