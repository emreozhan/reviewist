#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = fileURLToPath(new URL('../dist/server/server/cli.js', import.meta.url));
if (!existsSync(entry)) {
  console.error('Reviewist derlenmemiş. Önce `npm run build` çalıştırın.');
  process.exit(1);
}
await import(pathToFileURL(entry).href);
