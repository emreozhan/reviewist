/**
 * Paketi (dist/) üreten girdilerin özeti. `npm run build` bunu dist/BUILD.json'a yazar; öz-denetim (smoke) yeniden
 * hesaplayıp karşılaştırır. Böylece kaynak değişip paket yeniden derlenmeden depoya işlenirse fark edilir.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEXT_EXT = /\.(ts|tsx|js|mjs|json|css|html|md|txt)$/i;
const SKIP = /(\.test\.tsx?$)|(^src\/core\/testing\/)/;
const ROOTS = ['src', 'web', 'vendor'];
const FILES = ['package.json', 'package-lock.json', 'vite.config.ts', 'scripts/build.mjs'];

function walk(root, rel, out) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(root, child, out);
    else if (entry.isFile() && !SKIP.test(child)) out.push(child);
  }
}

/** Depo köküne göre girdi dosyalarının SHA-256 özeti (yol + içerik; metinlerde satır sonu LF'ye indirgenir). */
export function sourceHash(root) {
  const files = [...FILES];
  for (const dir of ROOTS) walk(root, dir, files);
  files.sort();
  const hash = createHash('sha256');
  for (const rel of files) {
    let content = readFileSync(join(root, rel));
    if (TEXT_EXT.test(rel)) content = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    hash.update(`${rel}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}
