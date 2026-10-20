import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'mock') {
    throw new Error('Mock mode is development/test only. Production builds use the real API.');
  }
  return {
    base: '/event-confirm/',
    worker: { format: 'es' },
    optimizeDeps: { include: ['exceljs', 'papaparse', 'fflate', 'zod'] },
    plugins: [react(), tailwind()],
    define: { __MOCK__: JSON.stringify(command === 'serve' && mode === 'mock') },
    server: { host: '127.0.0.1', port: 18446, strictPort: true },
  };
});
