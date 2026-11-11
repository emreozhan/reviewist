/**
 * Paketleri (local/dist, github/dist) üreten girdilerin özeti. `npm run build` bunu her uygulamanın dist/BUILD.json
 * dosyasına yazar; öz-denetim (smoke) yeniden hesaplayıp karşılaştırır. Böylece kaynak değişip paket yeniden
 * derlenmeden depoya işlenirse fark edilir.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEXT_EXT = /\.(ts|tsx|js|mjs|json|css|html|md|txt)$/i;
const SKIP = /(\.test\.tsx?$)|(^shared\/src\/core\/testing\/)/;
const ROOTS = ['shared/src', 'shared/web', 'shared/vendor', 'local/src', 'github/src'];
const FILES = ['package.json', 'package-lock.json', 'vite.config.ts', 'scripts/build.mjs', 'scripts/lib/bundleAudit.mjs'];

function walk(root, rel, out) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(root, child, out);
    else if (entry.isFile() && !SKIP.test(child)) out.push(child);
  }
}

/** Depo köküne göre girdi dosyalarının SHA-256 özeti (yol + içerik; metinlerde satır sonu LF'ye indirgenir). */
export function sourceHash(root) {
  const files = FILES.filter((f) => existsSync(join(root, f)));
  for (const dir of ROOTS) if (existsSync(join(root, dir))) walk(root, dir, files);
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

/** Kaynak ağacı mevcut mu (yalnız dist içeren dağıtımda değil). */
export function hasSources(root) {
  return existsSync(join(root, 'shared', 'src')) && existsSync(join(root, 'shared', 'web'));
}
