#!/usr/bin/env node
/**
 * Reviewist'i kurulum gerektirmeyen bir dağıtıma derler. Çıktı (`dist/`) depoya işlenir; böylece depoyu indiren
 * kişi `npm install` yapmadan, yalnızca Node ve git ile `node bin/reviewist.js` çalıştırabilir.
 *
 *   dist/server/cli.js              sunucu + analiz motoru + tüm npm bağımlılıkları (tek dosya)
 *   dist/server/parseWorker.js      Java ayrıştırma işçisi (worker_threads)
 *   dist/server/*.wasm              tree-sitter çalışma zamanı + Java dil bilgisi
 *   dist/web/                       arayüz (Vite)
 *   dist/THIRD-PARTY-LICENSES.txt   pakete giren üçüncü taraf yazılımların lisansları
 *   dist/BUILD.json                 sürüm + girdilerin özeti (paketin kaynakla güncel olduğunu denetlemek için)
 *
 * Kullanım: `npm run build` (geliştirme bağımlılıkları kurulu olmalı).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { sourceHash } from './lib/sourceHash.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const serverOut = join(dist, 'server');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Yalnızca depo kökündeki `dist` klasörü silinir. */
function cleanDist() {
  if (dirname(dist) !== root || !dist.endsWith(`${sep}dist`)) throw new Error(`Beklenmeyen dist yolu: ${dist}`);
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(serverOut, { recursive: true });
}

/** node_modules içindeki bir dosya yolundan paket kökünü bulur (iç içe node_modules dahil). */
function packageRootOf(file) {
  const norm = file.split('\\').join('/');
  const i = norm.lastIndexOf('/node_modules/');
  if (i < 0) return undefined;
  const rest = norm.slice(i + '/node_modules/'.length).split('/');
  const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  if (!name) return undefined;
  return { name, dir: `${norm.slice(0, i)}/node_modules/${name}` };
}

function licenseTextOf(dir) {
  const names = readdirSync(dir).filter((n) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n));
  names.sort((a, b) => a.localeCompare(b));
  return names
    .filter((n) => statSync(join(dir, n)).isFile())
    .map((n) => readFileSync(join(dir, n), 'utf8').replace(/\r\n/g, '\n').trim())
    .join('\n\n');
}

async function buildWeb() {
  const result = await viteBuild({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output ?? []);
  const ids = new Set();
  for (const chunk of outputs) for (const id of chunk.moduleIds ?? Object.keys(chunk.modules ?? {})) ids.add(id);
  return [...ids];
}

async function buildServer() {
  const result = await esbuild({
    absWorkingDir: root,
    entryPoints: { cli: 'src/server/cli.ts', parseWorker: 'src/core/java/parseWorker.ts' },
    outdir: serverOut,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    legalComments: 'none',
    charset: 'utf8',
    metafile: true,
    logLevel: 'warning',
    // CommonJS bağımlılıkların `require(...)` çağrıları ESM pakette çalışsın.
    banner: {
      js: "import { createRequire as __reviewistCreateRequire } from 'node:module';\nconst require = __reviewistCreateRequire(import.meta.url);",
    },
  });
  return Object.keys(result.metafile.inputs).map((p) => join(root, p));
}

function copyWasm() {
  const files = [
    [join(root, 'node_modules/web-tree-sitter/web-tree-sitter.wasm'), 'web-tree-sitter.wasm'],
    [join(root, 'vendor/tree-sitter-java/tree-sitter-java.wasm'), 'tree-sitter-java.wasm'],
  ];
  for (const [from, name] of files) {
    if (!existsSync(from)) throw new Error(`WebAssembly dosyası bulunamadı: ${relative(root, from)}`);
    copyFileSync(from, join(serverOut, name));
  }
}

function writeLicenses(moduleFiles) {
  const packages = new Map();
  for (const file of moduleFiles) {
    const p = packageRootOf(file);
    if (p && !packages.has(p.dir) && existsSync(join(p.dir, 'package.json'))) packages.set(p.dir, p.name);
  }
  // CSS üzerinden gelen yazı tipleri modül listesinde görünmeyebilir.
  for (const name of Object.keys(pkg.devDependencies ?? {}).filter((n) => n.startsWith('@fontsource'))) {
    const dir = join(root, 'node_modules', name).split('\\').join('/');
    if (existsSync(dir)) packages.set(dir, name);
  }
  const entries = [...packages.entries()]
    .map(([dir, name]) => {
      const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const license = typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'bilinmiyor');
      return { name, version: meta.version, license, text: licenseTextOf(dir) };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const vendorJava = readFileSync(join(root, 'vendor/tree-sitter-java/LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim();
  const sections = [
    'Reviewist dağıtımı (dist/) aşağıdaki üçüncü taraf yazılımları içerir. Her biri kendi lisansıyla dağıtılır.',
    `Bu dosya \`npm run build\` ile üretilir; elle düzenlemeyin.`,
    `${'='.repeat(78)}\ntree-sitter-java (vendor/tree-sitter-java, WebAssembly dil bilgisi) — MIT\n${'='.repeat(78)}\n${vendorJava}`,
    ...entries.map(
      (e) => `${'='.repeat(78)}\n${e.name}@${e.version} — ${e.license}\n${'='.repeat(78)}\n${e.text || '(pakette lisans dosyası yok; lisans alanı: ' + e.license + ')'}`,
    ),
  ];
  writeFileSync(join(dist, 'THIRD-PARTY-LICENSES.txt'), `${sections.join('\n\n')}\n`);
  return entries;
}

function sizeOf(dir) {
  let total = 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const s = sizeOf(p);
      total += s.total;
      count += s.count;
    } else {
      total += statSync(p).size;
      count += 1;
    }
  }
  return { total, count };
}

const t0 = Date.now();
cleanDist();
const webModules = await buildWeb();
const serverModules = await buildServer();
copyWasm();
const licensed = writeLicenses([...webModules, ...serverModules]);
writeFileSync(join(dist, 'BUILD.json'), `${JSON.stringify({ version: pkg.version, sourceHash: sourceHash(root) }, null, 2)}\n`);
const { total, count } = sizeOf(dist);
console.log(
  `Reviewist ${pkg.version} derlendi: dist/ ${count} dosya, ${(total / 1024 / 1024).toFixed(1)} MB, ` +
    `${licensed.length} üçüncü taraf paket, ${((Date.now() - t0) / 1000).toFixed(1)} sn`,
);
