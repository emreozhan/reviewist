#!/usr/bin/env node
/**
 * Öz-denetim: hazır paketin (dist/) bu makinede uçtan uca çalıştığını doğrular.
 * Yalnızca Node ve git gerekir; `npm install` gerekmez. Kullanım: `node scripts/smoke.mjs`
 *
 * Ne yapar:
 *  1. bin/, dist/ ve package.json'ı geçici bir klasöre kopyalar (node_modules OLMADAN çalıştığını kanıtlamak için).
 *  2. Geçici bir git deposunda küçük bir Java değişikliği oluşturur.
 *  3. Sunucuyu başlatır, analizi ve arayüz dosyalarını HTTP üzerinden denetler.
 *  4. Java ayrıştırma işçisini (worker_threads) doğrudan çalıştırır.
 *  5. Her şeyi kapatıp geçici dosyaları siler.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { sourceHash } from './lib/sourceHash.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failed = false;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

function makeRepo(dir) {
  const pkgDir = join(dir, 'src/main/java/com/acme');
  mkdirSync(pkgDir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(
    join(pkgDir, 'Greeter.java'),
    'package com.acme;\n\npublic class Greeter {\n    public String greet(String name) {\n        return "Merhaba " + name;\n    }\n}\n',
  );
  writeFileSync(
    join(pkgDir, 'App.java'),
    'package com.acme;\n\npublic class App {\n    public static void main(String[] args) {\n        System.out.println(new Greeter().greet("dünya"));\n    }\n}\n',
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'ilk');
  git(dir, 'checkout', '-q', '-b', 'feature/selam');
  writeFileSync(
    join(pkgDir, 'Greeter.java'),
    'package com.acme;\n\npublic class Greeter {\n    public String greet(String name, boolean formal) {\n        return (formal ? "Sayın " : "Merhaba ") + name;\n    }\n}\n',
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'imza değişti');
}

function waitForReady(child, timeoutMs) {
  return new Promise((resolveReady, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`Sunucu ${timeoutMs} ms içinde hazır olmadı. Çıktı:\n${out}`)), timeoutMs);
    const onData = (chunk) => {
      out += chunk.toString('utf8');
      if (out.includes('Durdurmak için')) {
        clearTimeout(timer);
        resolveReady(out);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Sunucu erken kapandı (kod ${code}). Çıktı:\n${out}`));
    });
  });
}

function runWorker(file) {
  return new Promise((resolveWorker, reject) => {
    const worker = new Worker(pathToFileURL(file));
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('işçi 20 sn içinde yanıt vermedi'));
    }, 20_000);
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.once('message', (msg) => {
      clearTimeout(timer);
      void worker.terminate();
      resolveWorker(msg);
    });
    worker.postMessage({ id: 1, items: [{ path: 'A.java', source: 'package p; class A { int f(int x) { return x + 1; } }' }] });
  });
}

console.log(`Reviewist öz-denetimi — Node ${process.versions.node}, ${process.platform}/${process.arch}`);

if (!existsSync(join(root, 'dist/server/cli.js'))) {
  console.error('dist/ bulunamadı: depo eksik indirilmiş olabilir.');
  process.exit(1);
}
try {
  console.log(`  git: ${execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()}`);
} catch {
  console.error('git bulunamadı. Git kurulu olmalı (macOS: `xcode-select --install`).');
  process.exit(1);
}

// Paket kaynakla güncel mi? (Kaynak klasörleri yoksa — yalnız bin/ + dist/ dağıtımı — atlanır.)
if (existsSync(join(root, 'src')) && existsSync(join(root, 'web'))) {
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(join(root, 'dist/BUILD.json'), 'utf8')).sourceHash;
  } catch {
    recorded = undefined;
  }
  check('paket (dist/) kaynak kodla güncel', recorded === sourceHash(root), recorded ? '' : 'dist/BUILD.json okunamadı');
  if (failed) console.log('    Kaynak değişmiş ama paket yeniden derlenmemiş: `npm run build` çalıştırın.');
}

// macOS'ta tmpdir sembolik bağdır (/var → /private/var); gerçek yol kullanılır.
const work = realpathSync(mkdtempSync(join(tmpdir(), 'reviewist-smoke-')));
let server;
try {
  const app = join(work, 'app');
  const repo = join(work, 'repo');
  mkdirSync(repo, { recursive: true });
  for (const name of ['bin', 'dist']) cpSync(join(root, name), join(app, name), { recursive: true });
  cpSync(join(root, 'package.json'), join(app, 'package.json'));
  check('paket node_modules olmadan kopyalandı', !existsSync(join(app, 'node_modules')));

  makeRepo(repo);
  const port = await freePort();
  server = spawn(process.execPath, [join(app, 'bin/reviewist.js'), repo, '--base', 'main', '--head', 'feature/selam', '--no-open', '--port', String(port)], {
    cwd: app,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const banner = await waitForReady(server, 60_000);
  check('sunucu başladı ve ilk analiz tamamlandı', /Review hazır/.test(banner));

  const base = `http://127.0.0.1:${port}`;
  const config = await (await fetch(`${base}/api/config`)).json();
  check('GET /api/config', typeof config.version === 'string' && typeof config.initialReviewId === 'string', `sürüm ${config.version}`);

  const model = await (await fetch(`${base}/api/reviews/${config.initialReviewId}`, { headers: { 'accept-encoding': 'gzip' } })).json();
  const greeter = model.types?.find((t) => t.name === 'Greeter');
  const greet = greeter?.members?.find((m) => m.name === 'greet');
  check('Java analizi (tree-sitter wasm) çalışıyor', !!greet, greet ? `${greet.status}: ${greet.signature}` : 'Greeter.greet bulunamadı');
  check('imza değişikliği algılandı', greet?.status === 'signatureChanged');
  check('diff dışı çağıran bulundu (App.main)', (greet?.callers ?? []).some((c) => String(c.fromId).includes('App#main')) || (model.graph?.nodes ?? []).some((n) => String(n.id).includes('App#main')));

  const refs = await (await fetch(`${base}/api/git/refs?repoPath=${encodeURIComponent(repo)}`)).json();
  check('dal listesi', Array.isArray(refs.branches) && refs.branches.includes('main') && refs.branches.includes('feature/selam'), (refs.branches ?? []).join(', '));

  const listing = await (await fetch(`${base}/api/fs/list?path=${encodeURIComponent(work)}`)).json();
  check('klasör seçici git deposunu tanıyor', (listing.entries ?? []).some((e) => e.name === 'repo' && e.isGitRepo), listing.error ?? '');

  const html = await (await fetch(`${base}/`)).text();
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  check('arayüz (index.html) sunuluyor', html.includes('<div id="root">') && !!asset);
  if (asset) {
    const res = await fetch(`${base}${asset}`);
    check('arayüz paketi sunuluyor', res.ok && (await res.text()).length > 100_000, asset);
  }
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  check('arayüz dış adresten kaynak yüklemiyor', external.length === 0, external.join(', '));

  const workerMsg = await runWorker(join(app, 'dist/server/parseWorker.js'));
  const parsed = workerMsg?.models?.[0];
  check('ayrıştırma işçisi (worker_threads) çalışıyor', parsed?.types?.[0]?.name === 'A', parsed?.error ?? '');
} catch (err) {
  check('beklenmeyen hata', false, err instanceof Error ? err.message : String(err));
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((r) => {
      server.once('exit', r);
      setTimeout(r, 3000);
    });
  }
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.log(`  (geçici klasör silinemedi: ${work})`);
  }
}

console.log(failed ? '\nBAŞARISIZ: yukarıdaki ✗ satırlarına bakın.' : `\nTAMAM: ${results.length} denetimin hepsi geçti.`);
process.exit(failed ? 1 : 0);
