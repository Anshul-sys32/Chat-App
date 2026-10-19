import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    define: {
      'process.env.VITE_KEY': JSON.stringify(env.VITE_KEY)
    },
    server: {
      host: env.VITE_HOST || '::',
      port: Number(env.VITE_PORT || 5174),
      strictPort: true,
      allowedHosts: ['2405:201:6811:a82a:3aed:adb3:3ebd:d4b1']
    },
    preview: {
      host: env.VITE_HOST || '::',
      port: Number(env.VITE_PREVIEW_PORT || 4174),
      strictPort: true,
      allowedHosts: ['2405:201:6811:a82a:3aed:adb3:3ebd:d4b1']
    }
  }
})
