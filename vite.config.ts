import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  cacheDir: `node_modules/.cache/vite-${mode}`,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  optimizeDeps: {
    entries: [
      'index.html',
      'tests/fixtures/primitives.html',
      'tests/fixtures/session.html',
      'tests/fixtures/realtime.html',
      'tests/fixtures/creator.html',
    ],
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { sourcemap: false },
}));
