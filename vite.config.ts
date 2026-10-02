import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./web', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('./dist/web', import.meta.url)), emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4317' },
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] },
  },
});
