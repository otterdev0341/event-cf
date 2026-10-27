import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Go backend (backend/) serves the API; run it on API_ORIGIN during `npm run dev`.
const base = '/event-confirm/';
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', proxy: { [`${base}api/`]: process.env.API_ORIGIN || 'http://127.0.0.1:8080' } },
});
