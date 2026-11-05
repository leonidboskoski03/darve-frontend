import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The normal API composition, with no dotenv merge, fixture dependency, login or control HTTP route.
let server, dependencies, closing;
const load = (file) => import(pathToFileURL(path.join(process.argv[2], file)).href);
const close = () =>
  (closing ??= (async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    await dependencies?.close();
  })());
try {
  const [{ readApiEnvironment }, { createApp }, { createDependencies }, { createLogger }] =
    await Promise.all([
      load('apps/api/dist/config/environment.js'),
      load('apps/api/dist/app.js'),
      load('apps/api/dist/composition/runtime.js'),
      load('apps/api/dist/logging/logger.js'),
    ]);
  const config = readApiEnvironment(process.env),
    logger = createLogger('silent');
  dependencies = createDependencies(config, logger);
  if ((await dependencies.checkReadiness()).status !== 'ready')
    throw Error('Dependencies unavailable.');
  await dependencies.startProviderMaintenance();
  server = createApp(config, logger, dependencies).listen(3000, '127.0.0.1', () =>
    process.send?.({ type: 'ready' }),
  );
  server.on('error', () => {
    void close().finally(() => process.exit(1));
  });
  process.on('message', (message) => {
    if (message?.action === 'stop' && message.runId === process.env.CONNECTED_RUN_ID)
      void close().finally(() => process.exit(0));
  });
  process.once('disconnect', () => {
    void close().finally(() => process.exit(0));
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void close().finally(() => process.exit(0));
    });
} catch {
  await close();
  process.stderr.write('Connected API startup failed; private configuration is not printed.\n');
  process.exitCode = 1;
}
