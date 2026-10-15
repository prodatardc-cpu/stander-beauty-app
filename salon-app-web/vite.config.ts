import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { resolveApiUrl } from './config/apiUrl.ts'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Every build is meant to be deployed: refuse to build without a valid API address (see .env.example).
  if (command === 'build') resolveApiUrl(loadEnv(mode, process.cwd(), 'VITE_'), { production: true })

  return {
    plugins: [react(), tailwindcss()],
  }
})
