import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config.ts';

// Separate static fixture build; never changes the product build's HTML entries.
export default defineConfig((environment) =>
  mergeConfig(viteConfig(environment), {
    envDir: false,
    build: {
      outDir: 'dist-acceptance',
      rolldownOptions: {
        input: Object.fromEntries(
          ['primitives', 'session', 'realtime', 'creator'].map((name) => [
            name,
            fileURLToPath(new URL(`./tests/fixtures/${name}.html`, import.meta.url)),
          ]),
        ),
      },
    },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  }),
);
