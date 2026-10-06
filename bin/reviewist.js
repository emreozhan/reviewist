#!/usr/bin/env node
// Reviewist başlatıcısı: depodaki hazır paketi (dist/) çalıştırır; `npm install` gerekmez.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIN_NODE_MAJOR = 20;
const major = Number(process.versions.node.split('.')[0]);
if (!(major >= MIN_NODE_MAJOR)) {
  console.error(`Reviewist Node.js ${MIN_NODE_MAJOR} ya da üstünü gerektirir (bulunan: ${process.versions.node}).`);
  process.exit(1);
}

const entry = fileURLToPath(new URL('../dist/server/cli.js', import.meta.url));
if (!existsSync(entry)) {
  console.error('Hazır paket (dist/) bulunamadı. Depoyu eksiksiz indirdiğinizden emin olun ya da `npm install && npm run build` çalıştırın.');
  process.exit(1);
}
await import(pathToFileURL(entry).href);
