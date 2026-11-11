import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const dir = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Arayüz iki uygulama için ayrı derlenir; `--mode github` GitHub uygulamasını, diğer her şey yerel uygulamayı seçer.
 * `__EDITION__` derleme sabiti olduğundan diğer uygulamanın formları pakete girmez.
 * Geliştirme: `vite` (yerel, API 4317) ya da `vite --mode github` (API 4318).
 */
export default defineConfig(({ mode }) => {
  const edition = mode === 'github' ? 'github' : 'local';
  return {
    root: dir('./shared/web'),
    plugins: [react()],
    define: { __EDITION__: JSON.stringify(edition) },
    build: {
      outDir: dir(`./${edition}/dist/web`),
      emptyOutDir: true,
      // Yazı tipleri hiçbir zaman `data:` adresi olarak gömülmez: içerik güvenlik politikası (`font-src 'self'`) engeller.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf|eot)$/i.test(file) ? false : undefined),
    },
    server: {
      port: 5173,
      proxy: { '/api': `http://127.0.0.1:${edition === 'github' ? 4318 : 4317}` },
      fs: { allow: [dir('.')] },
    },
  };
});
