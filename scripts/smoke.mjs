#!/usr/bin/env node
/**
 * Öz-denetim: iki hazır paketin (local/, github/) bu makinede uçtan uca ve BİRBİRİNDEN BAĞIMSIZ çalıştığını doğrular.
 * Yalnızca Node ve git gerekir; `npm install` gerekmez.
 *
 * Kullanım: `node scripts/smoke.mjs` (ikisi) · `node scripts/smoke.mjs local` · `node scripts/smoke.mjs github`
 *
 * Her uygulama için:
 *  1. Yalnız o uygulamanın klasörünü (bin/, dist/, package.json) geçici bir yere kopyalar; node_modules, shared/ ve
 *     diğer uygulama OLMADAN çalıştığını kanıtlar.
 *  2. Geçici bir git deposunda küçük bir Java değişikliği oluşturur (GitHub uygulaması için bu depo, ağa çıkmadan
 *     `file://` adresiyle "uzak depo" olarak kullanılır).
 *  3. Sunucuyu başlatır; analizi, arayüz dosyalarını ve tarayıcı güvenlik başlıklarını HTTP üzerinden denetler.
 *  4. Java ayrıştırma işçisini (worker_threads) doğrudan çalıştırır.
 *  5. Her şeyi kapatıp geçici dosyaları siler.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { hasSources, sourceHash } from './lib/sourceHash.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = { local: 'reviewist-local', github: 'reviewist-github' };
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const a of wanted) {
  if (!(a in APPS)) {
    console.error(`Bilinmeyen uygulama: ${a} (local | github)`);
    process.exit(2);
  }
}
const editions = wanted.length ? wanted : Object.keys(APPS);

let total = 0;
let failed = false;

function check(name, ok, detail = '') {
  total += 1;
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

async function stop(server) {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await new Promise((r) => {
    server.once('exit', r);
    setTimeout(r, 3000);
  });
}

/** Analiz sonucu, arayüz ve güvenlik başlıkları: iki uygulamada ortak denetimler. */
async function checkCommon(base, edition, appDir) {
  const configRes = await fetch(`${base}/api/config`);
  const config = await configRes.json();
  check(
    'GET /api/config',
    typeof config.version === 'string' && typeof config.initialReviewId === 'string' && config.edition === edition,
    `sürüm ${config.version}, uygulama ${config.edition}`,
  );

  const model = await (await fetch(`${base}/api/reviews/${config.initialReviewId}`, { headers: { 'accept-encoding': 'gzip' } })).json();
  const greeter = model.types?.find((t) => t.name === 'Greeter');
  const greet = greeter?.members?.find((m) => m.name === 'greet');
  check('Java analizi (tree-sitter wasm) çalışıyor', !!greet, greet ? `${greet.status}: ${greet.signature}` : 'Greeter.greet bulunamadı');
  check('imza değişikliği algılandı', greet?.status === 'signatureChanged');
  check(
    'diff dışı çağıran bulundu (App.main)',
    (greet?.callers ?? []).some((c) => String(c.fromId).includes('App#main')) || (model.graph?.nodes ?? []).some((n) => String(n.id).includes('App#main')),
  );

  const pageRes = await fetch(`${base}/`);
  const html = await pageRes.text();
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  check('arayüz (index.html) sunuluyor', html.includes('<div id="root">') && !!asset);
  if (asset) {
    const res = await fetch(`${base}${asset}`);
    check('arayüz paketi sunuluyor', res.ok && (await res.text()).length > 100_000, asset);
  }
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  check('arayüz dış adresten kaynak yüklemiyor', external.length === 0, external.join(', '));

  const csp = pageRes.headers.get('content-security-policy') ?? '';
  check(
    'içerik güvenlik politikası: sayfa yalnız kendi sunucusuna bağlanabilir',
    csp.includes("default-src 'none'") && csp.includes("connect-src 'self'") && csp.includes("script-src 'self'") && !/https?:|\*/.test(csp),
    csp ? '' : 'Content-Security-Policy başlığı yok',
  );
  check('API yanıtlarında da güvenlik başlıkları var', (configRes.headers.get('content-security-policy') ?? '') === csp && configRes.headers.get('x-content-type-options') === 'nosniff');

  const workerMsg = await runWorker(join(appDir, 'dist/server/parseWorker.js'));
  const parsed = workerMsg?.models?.[0];
  check('ayrıştırma işçisi (worker_threads) çalışıyor', parsed?.types?.[0]?.name === 'A', parsed?.error ?? '');
  return config;
}

async function smoke(edition) {
  const name = APPS[edition];
  const src = join(root, edition);
  console.log(`\n${name}`);
  if (!existsSync(join(src, 'dist/server/cli.js'))) {
    check(`${edition}/dist bulundu`, false, 'paket yok: depo eksik indirilmiş olabilir ya da `npm run build` gerekir');
    return;
  }

  // Paket kaynakla güncel mi? (Kaynak klasörleri yoksa — yalnız uygulama klasörü dağıtıldıysa — atlanır.)
  if (hasSources(root)) {
    let build;
    try {
      build = JSON.parse(readFileSync(join(src, 'dist/BUILD.json'), 'utf8'));
    } catch {
      build = undefined;
    }
    const fresh = build?.sourceHash === sourceHash(root);
    check(`paket (${edition}/dist) kaynak kodla güncel`, fresh, build ? '' : 'BUILD.json okunamadı');
    if (!fresh) console.log('    Kaynak değişmiş ama paket yeniden derlenmemiş: `npm run build` çalıştırın.');
    check('BUILD.json bu uygulamaya ait', build?.app === name, build?.app ?? '');
  }

  // macOS'ta tmpdir sembolik bağdır (/var → /private/var); gerçek yol kullanılır.
  const work = realpathSync(mkdtempSync(join(tmpdir(), `reviewist-smoke-${edition}-`)));
  let server;
  try {
    const app = join(work, 'app');
    const repo = join(work, 'repo');
    mkdirSync(repo, { recursive: true });
    for (const part of ['bin', 'dist']) cpSync(join(src, part), join(app, part), { recursive: true });
    cpSync(join(src, 'package.json'), join(app, 'package.json'));
    check(
      'uygulama tek başına kopyalandı (node_modules, shared/ ve diğer uygulama yok)',
      readdirSync(app).sort().join(',') === 'bin,dist,package.json' && readdirSync(work).sort().join(',') === 'app,repo',
    );

    makeRepo(repo);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const bin = join(app, 'bin', `${name}.js`);

    if (edition === 'local') {
      server = spawn(process.execPath, [bin, repo, '--base', 'main', '--head', 'feature/selam', '--no-open', '--port', String(port)], {
        cwd: app,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const banner = await waitForReady(server, 60_000);
      check('sunucu başladı ve ilk analiz tamamlandı', /Review hazır/.test(banner));
      await checkCommon(base, edition, app);

      const refs = await (await fetch(`${base}/api/git/refs?repoPath=${encodeURIComponent(repo)}`)).json();
      check('dal listesi', Array.isArray(refs.branches) && refs.branches.includes('main') && refs.branches.includes('feature/selam'), (refs.branches ?? []).join(', '));
      const listing = await (await fetch(`${base}/api/fs/list?path=${encodeURIComponent(work)}`)).json();
      check('klasör seçici git deposunu tanıyor', (listing.entries ?? []).some((e) => e.name === 'repo' && e.isGitRepo), listing.error ?? '');
      const remote = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'github', url: 'https://github.com/a/b/pull/1' }),
      });
      check('yerel uygulama uzak depo isteğini reddediyor', remote.status === 400, `HTTP ${remote.status}`);
    } else {
      // "Uzak depo": yerel bir çıplak depo, file:// adresiyle (ağa çıkılmaz). Bu taşıyıcı yalnız aşağıdaki ortam
      // değişkeniyle açılır; normal kullanımda kapalıdır.
      const remoteDir = join(work, 'remote.git');
      git(work, 'clone', '-q', '--bare', repo, remoteDir);
      rmSync(repo, { recursive: true, force: true });
      mkdirSync(repo);
      const cacheDir = join(work, 'cache');
      const url = pathToFileURL(remoteDir).href;
      server = spawn(
        process.execPath,
        [bin, url, '--base', 'main', '--head', 'feature/selam', '--cache-dir', cacheDir, '--no-open', '--port', String(port)],
        {
          cwd: app,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, REVIEWIST_ALLOW_FILE_REMOTE: '1', GITHUB_TOKEN: '', GH_TOKEN: '' },
        },
      );
      const banner = await waitForReady(server, 90_000);
      check('sunucu başladı; depo git ile önbelleğe getirildi ve ilk analiz tamamlandı', /Review hazır/.test(banner));
      const config = await checkCommon(base, edition, app);
      check('klon önbelleği --cache-dir altında', existsSync(cacheDir) && readdirSync(cacheDir).length > 0 && config.cacheDir === cacheDir, config.cacheDir ?? '');
      check('token ayarlı değilken bildirilir', config.githubTokenConfigured === false);
      const refs = await fetch(`${base}/api/git/refs?repoPath=${encodeURIComponent(work)}`);
      const fsList = await fetch(`${base}/api/fs/list`);
      check('GitHub uygulamasında yerel depo/dosya sistemi uçları yok', refs.status === 404 && fsList.status === 404, `refs ${refs.status}, fs ${fsList.status}`);
      const local = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'git', repoPath: work, base: 'main', head: 'feature/selam' }),
      });
      check('GitHub uygulaması yerel depo isteğini reddediyor', local.status === 400, `HTTP ${local.status}`);
    }
  } catch (err) {
    check('beklenmeyen hata', false, err instanceof Error ? err.message : String(err));
  } finally {
    await stop(server);
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.log(`  (geçici klasör silinemedi: ${work})`);
    }
  }
}

console.log(`Reviewist öz-denetimi — Node ${process.versions.node}, ${process.platform}/${process.arch}`);
try {
  console.log(`  git: ${execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()}`);
} catch {
  console.error('git bulunamadı. Git kurulu olmalı (macOS: `xcode-select --install`).');
  process.exit(1);
}

for (const edition of editions) await smoke(edition);

console.log(failed ? '\nBAŞARISIZ: yukarıdaki ✗ satırlarına bakın.' : `\nTAMAM: ${total} denetimin hepsi geçti.`);
process.exit(failed ? 1 : 0);
