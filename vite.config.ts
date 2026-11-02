import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  cacheDir: `node_modules/.cache/vite-${mode}`,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'isolated-overlay-entry',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (/^\/overlay\/[^/?]+(?:\?.*)?$/.test(request.url ?? '')) {
            request.url = '/overlay.html';
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Referrer-Policy', 'no-referrer');
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (/^\/overlay\/[^/?]+(?:\?.*)?$/.test(request.url ?? '')) {
            request.url = '/overlay.html';
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Referrer-Policy', 'no-referrer');
          }
          next();
        });
      },
    },
  ],
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
  build: {
    sourcemap: false,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        overlay: fileURLToPath(new URL('./overlay.html', import.meta.url)),
      },
    },
  },
}));
