import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Go backend (backend/) serves the API; run it on API_ORIGIN during `npm run dev`.
const base = '/event-confirm/';
export default defineConfig({
  base,
  plugins: [react()],
  server: { host: '127.0.0.1', proxy: { [`${base}api`]: process.env.API_ORIGIN || 'http://127.0.0.1:8080' } },
});
