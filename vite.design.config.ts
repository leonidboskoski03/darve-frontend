import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';
import { designPreview } from './tools/design/server';

export default defineConfig((environment) => {
  if (
    environment.command !== 'serve' ||
    environment.isPreview ||
    environment.mode !== 'design' ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error('Design mode is available only through the local development server.');
  }

  const origin = 'http://127.0.0.1:5178';
  return mergeConfig(baseConfig({ ...environment, mode: 'development' }), {
    envDir: false,
    envPrefix: 'DARVE_DESIGN_UNUSED_',
    define: {
      'import.meta.env.VITE_PUBLIC_API_ORIGIN': JSON.stringify(origin),
      'import.meta.env.VITE_APP_ENV': JSON.stringify('local'),
    },
    server: { host: '127.0.0.1', port: 5178, strictPort: true },
    plugins: [designPreview(origin)],
  });
});
