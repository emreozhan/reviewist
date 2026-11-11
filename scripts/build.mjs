#!/usr/bin/env node
/**
 * İki uygulamayı (local/, github/) kurulum gerektirmeyen, birbirinden bağımsız dağıtımlar olarak derler. Her
 * uygulamanın `dist/` klasörü depoya işlenir; uygulama klasörü tek başına kopyalanıp `node bin/…` ile çalıştırılabilir.
 *
 *   <uygulama>/dist/server/cli.js           sunucu + analiz motoru + tüm npm bağımlılıkları (tek dosya)
 *   <uygulama>/dist/server/parseWorker.js   Java ayrıştırma işçisi (worker_threads)
 *   <uygulama>/dist/server/*.wasm           tree-sitter çalışma zamanı + Java dil bilgisi
 *   <uygulama>/dist/web/                    arayüz (Vite; uygulamaya özel derlenir)
 *   <uygulama>/dist/THIRD-PARTY-LICENSES.txt
 *   <uygulama>/dist/BUILD.json              sürüm, girdilerin özeti, pakete giren kütüphaneler
 *
 * Derleme, paket denetiminden (scripts/lib/bundleAudit.mjs) geçemezse durur: izin listesinde olmayan bir kütüphane,
 * yeni bir ağ yeteneği ya da yerel uygulamada herhangi bir dış istek kodu bulunursa çıktı yazılmaz.
 *
 * Kullanım: `npm run build` (ikisi) · `node scripts/build.mjs local` · `node scripts/build.mjs github`
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { auditServerBundle, auditWebBundle } from './lib/bundleAudit.mjs';
import { sourceHash } from './lib/sourceHash.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const EDITIONS = ['local', 'github'];
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const editions = wanted.length ? wanted : EDITIONS;
for (const e of editions) if (!EDITIONS.includes(e)) throw new Error(`Bilinmeyen uygulama: ${e} (local | github)`);

/** Yalnızca `<uygulama>/dist` klasörü silinir. */
function cleanDist(dist) {
  if (!EDITIONS.some((e) => dist === join(root, e, 'dist')) || !dist.endsWith(`${sep}dist`)) throw new Error(`Beklenmeyen dist yolu: ${dist}`);
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'server'), { recursive: true });
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

async function buildWeb(edition) {
  const result = await viteBuild({ configFile: join(root, 'vite.config.ts'), mode: edition === 'github' ? 'github' : 'production', logLevel: 'warn' });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output ?? []);
  const ids = new Set();
  for (const chunk of outputs) for (const id of chunk.moduleIds ?? Object.keys(chunk.modules ?? {})) ids.add(id);
  return [...ids];
}

async function buildServer(edition, outdir) {
  const result = await esbuild({
    absWorkingDir: root,
    entryPoints: { cli: `${edition}/src/cli.ts`, parseWorker: 'shared/src/core/java/parseWorker.ts' },
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    legalComments: 'none',
    charset: 'utf8',
    metafile: true,
    logLevel: 'warning',
    define: { __REVIEWIST_VERSION__: JSON.stringify(pkg.version) },
    // CommonJS bağımlılıkların `require(...)` çağrıları ESM pakette çalışsın.
    banner: {
      js: "import { createRequire as __reviewistCreateRequire } from 'node:module';\nconst require = __reviewistCreateRequire(import.meta.url);",
    },
  });
  return Object.keys(result.metafile.inputs);
}

function copyWasm(serverOut) {
  const files = [
    [join(root, 'node_modules/web-tree-sitter/web-tree-sitter.wasm'), 'web-tree-sitter.wasm'],
    [join(root, 'shared/vendor/tree-sitter-java/tree-sitter-java.wasm'), 'tree-sitter-java.wasm'],
  ];
  for (const [from, name] of files) {
    if (!existsSync(from)) throw new Error(`WebAssembly dosyası bulunamadı: ${relative(root, from)}`);
    copyFileSync(from, join(serverOut, name));
  }
}

function writeLicenses(dist, moduleFiles) {
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
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));

  const vendorJava = readFileSync(join(root, 'shared/vendor/tree-sitter-java/LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim();
  const bar = '='.repeat(78);
  const sections = [
    'Bu dağıtım (dist/) aşağıdaki üçüncü taraf yazılımları içerir. Her biri kendi lisansıyla dağıtılır.',
    'Bu dosya `npm run build` ile üretilir; elle düzenlemeyin.',
    `${bar}\ntree-sitter-java (WebAssembly dil bilgisi) — MIT\n${bar}\n${vendorJava}`,
    ...entries.map((e) => `${bar}\n${e.name}@${e.version} — ${e.license}\n${bar}\n${e.text || `(pakette lisans dosyası yok; lisans alanı: ${e.license})`}`),
  ];
  writeFileSync(join(dist, 'THIRD-PARTY-LICENSES.txt'), `${sections.join('\n\n')}\n`);
  return entries.length;
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

const hash = sourceHash(root);
let failed = false;
for (const edition of editions) {
  const t0 = Date.now();
  const dist = join(root, edition, 'dist');
  const serverOut = join(dist, 'server');
  cleanDist(dist);
  const webModules = await buildWeb(edition);
  const serverInputs = await buildServer(edition, serverOut);

  const server = auditServerBundle(root, edition, serverInputs);
  const problems = [...server.problems, ...auditWebBundle(join(dist, 'web'), edition)];
  if (problems.length > 0) {
    failed = true;
    rmSync(dist, { recursive: true, force: true });
    console.error(`\nPAKET DENETİMİ BAŞARISIZ (${edition}) — çıktı yazılmadı:`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error('  Beklenen bir değişiklikse scripts/lib/bundleAudit.mjs içindeki izin listesini bilinçli olarak güncelleyin.\n');
    continue;
  }

  copyWasm(serverOut);
  const licensed = writeLicenses(dist, [...webModules, ...serverInputs.map((p) => join(root, p))]);
  writeFileSync(
    join(dist, 'BUILD.json'),
    `${JSON.stringify({ app: `reviewist-${edition}`, version: pkg.version, sourceHash: hash, serverPackages: server.packages }, null, 2)}\n`,
  );
  const { total, count } = sizeOf(dist);
  console.log(
    `reviewist-${edition} ${pkg.version} derlendi: ${edition}/dist ${count} dosya, ${(total / 1024 / 1024).toFixed(1)} MB; ` +
      `sunucuya gömülü kütüphaneler: ${server.packages.map((p) => p.name).join(', ')}; ${licensed} lisans; ${((Date.now() - t0) / 1000).toFixed(1)} sn`,
  );
}
if (failed) process.exit(1);
