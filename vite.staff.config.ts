import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const entry: Plugin = {
  name: 'staff-only-entry',
  configureServer(server) {
    server.middlewares.use(rewrite);
  },
  configurePreviewServer(server) {
    server.middlewares.use(rewrite);
  },
};
function rewrite(
  request: { url?: string | undefined },
  response: { statusCode: number; end: (text: string) => unknown },
  next: () => void,
) {
  const path = (request.url ?? '/').split('?')[0];
  if (['/', '/staff/enrol', '/staff/verify-email', '/tickets', '/reviews'].includes(path ?? ''))
    request.url = '/staff.html';
  else if (path?.endsWith('.html') && path !== '/staff.html') {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }
  next();
}
export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('./env/staff', import.meta.url));
  const env = loadEnv(mode, envDir, 'STAFF_PUBLIC_');
  const api = process.env.STAFF_PUBLIC_API_ORIGIN ?? env.STAFF_PUBLIC_API_ORIGIN;
  const connect = api ? new URL(api).origin : '';
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
  return {
    appType: 'mpa',
    envDir,
    envPrefix: 'STAFF_PUBLIC_',
    cacheDir: `node_modules/.cache/vite-staff-${mode}`,
    plugins: [react(), tailwindcss(), entry],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    optimizeDeps: { entries: ['staff.html'] },
    server: { host: 'localhost', port: 5176, strictPort: true, headers },
    preview: {
      host: 'localhost',
      port: 4176,
      strictPort: true,
      headers: {
        ...headers,
        'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' ${connect}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    },
    build: {
      outDir: 'dist-staff',
      sourcemap: false,
      rolldownOptions: {
        input: { staff: fileURLToPath(new URL('./staff.html', import.meta.url)) },
      },
    },
  };
});
