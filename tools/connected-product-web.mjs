import { createServer } from 'vite';
import { frontendRoot, isPrivateProductPath } from './connected-product-config.mjs';

let server;
try {
  server = await createServer({
    root: frontendRoot,
    configFile: 'vite.config.ts',
    envDir: false,
    mode: 'connected-product',
    clearScreen: false,
    logLevel: 'silent',
    optimizeDeps: { entries: ['index.html', 'overlay.html'] },
    plugins: [
      {
        name: 'connected-product-private-paths',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (isPrivateProductPath(request.url ?? '')) {
              response.statusCode = 404;
              response.end();
            } else next();
          });
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      fs: {
        strict: true,
        allow: [frontendRoot],
        deny: [
          '**/.git/**',
          '**/.env',
          '**/.env.*',
          '**/*.local/**',
          '**/test-results/**',
          '**/playwright-report/**',
        ],
      },
    },
  });
  await server.listen();
  process.send?.({ type: 'ready' });
  const stop = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('message', (m) => {
    if (m?.action === 'stop' && m.runId === process.env.CONNECTED_RUN_ID) stop();
  });
  process.once('disconnect', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
} catch {
  await server?.close();
  process.stderr.write('Connected frontend startup failed.\n');
  process.exitCode = 1;
}
