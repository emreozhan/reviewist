#!/usr/bin/env node
/**
 * `mac` ve `macClean` dallarını `main`'in güncel halinden yeniden üretir.
 *
 *   mac       yalnız hazır paket: bin/, dist/, öz-denetim betiği, LICENSE — npm install gerekmez
 *   macClean  yalnız kaynak kod: testler, belgeler, fikstür ve dist/ yok — npm install derler, npm start çalıştırır
 *
 * Dal içerikleri main'den süzülür; README, .gitignore ve package.json dala özel üretilir (şablonlar: scripts/branches/).
 * Her dal geçici bir git worktree içinde güncellenir; çalışma klasörünüze dokunulmaz. Değişiklik yoksa commit atılmaz.
 *
 * Kullanım: main dalında, temiz bir çalışma ağacında ve güncel bir dist/ ile:
 *   node scripts/sync-branches.mjs            # iki dalı günceller
 *   node scripts/sync-branches.mjs --push     # ardından origin'e gönderir
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceHash } from './lib/sourceHash.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const push = process.argv.includes('--push');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fail(msg) {
  console.error(`Hata: ${msg}`);
  process.exit(1);
}

// --- dal tanımları ---------------------------------------------------------

const isTest = (p) => /\.test\.tsx?$/.test(p) || p.startsWith('src/core/testing/');

const BRANCHES = {
  mac: {
    keep: (p) =>
      p.startsWith('bin/') || p.startsWith('dist/') || p === 'scripts/smoke.mjs' || p === 'scripts/lib/sourceHash.mjs' || p === 'LICENSE' || p === '.gitattributes',
    packageJson: (pkg) => ({
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: 'module',
      description: 'Java odakli yerel kod inceleme araci (hazir paket; kurulum gerektirmez)',
      license: pkg.license,
      author: pkg.author,
      bin: pkg.bin,
      engines: pkg.engines,
      scripts: { start: 'node bin/reviewist.js', smoke: 'node scripts/smoke.mjs' },
    }),
  },
  macClean: {
    keep: (p) =>
      !(
        p.startsWith('dist/') ||
        p.startsWith('docs/') ||
        p.startsWith('fixtures/') ||
        p.startsWith('scripts/branches/') ||
        isTest(p) ||
        ['scripts/make-fixture.mjs', 'scripts/vitest-global-setup.mjs', 'scripts/sync-branches.mjs', 'vitest.config.ts', 'tsconfig.check.json'].includes(p)
      ),
    packageJson: (pkg) => {
      const out = { ...pkg };
      delete out.files;
      out.description = 'Java odakli yerel kod inceleme araci (kaynak kod; npm install ile derlenir)';
      out.scripts = {
        prepare: 'node scripts/build.mjs',
        start: 'node bin/reviewist.js',
        build: 'node scripts/build.mjs',
        smoke: 'node scripts/smoke.mjs',
        typecheck: 'tsc -p tsconfig.json && tsc -p web/tsconfig.json',
        'dev:server': pkg.scripts['dev:server'],
        'dev:web': pkg.scripts['dev:web'],
      };
      return out;
    },
  },
};

// --- ön koşullar -------------------------------------------------------------

if (git(root, 'branch', '--show-current') !== 'main') fail('main dalında olmalısınız.');
if (git(root, 'status', '--porcelain', '--untracked-files=no') !== '') fail('Çalışma ağacında commit edilmemiş değişiklik var.');
const build = JSON.parse(readFileSync(join(root, 'dist/BUILD.json'), 'utf8'));
if (build.sourceHash !== sourceHash(root)) fail('dist/ kaynakla güncel değil: önce `npm run build` çalıştırıp commit edin.');

const mainSha = git(root, 'rev-parse', '--short', 'HEAD');
const files = git(root, 'ls-files', '-z').split('\0').filter(Boolean);
const mainPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// --- dalları üret -------------------------------------------------------------

const results = [];
for (const [name, def] of Object.entries(BRANCHES)) {
  const wt = mkdtempSync(join(tmpdir(), `reviewist-sync-${name}-`));
  rmSync(wt, { recursive: true, force: true });
  const exists = git(root, 'branch', '--list', name) !== '';
  if (exists) git(root, 'worktree', 'add', '--quiet', wt, name);
  else git(root, 'worktree', 'add', '--quiet', '-b', name, wt, 'main');
  try {
    // Daldaki eski içeriği boşalt (yalnız izlenenler), sonra main'den süzerek kopyala.
    const old = git(wt, 'ls-files', '-z').split('\0').filter(Boolean);
    if (old.length) git(wt, 'rm', '-r', '-q', '--cached', '--', '.');
    for (const p of old) rmSync(join(wt, p), { force: true });
    let count = 0;
    for (const p of files) {
      if (!def.keep(p)) continue;
      mkdirSync(dirname(join(wt, p)), { recursive: true });
      copyFileSync(join(root, p), join(wt, p));
      count++;
    }
    const tpl = join(root, 'scripts', 'branches', name);
    copyFileSync(join(tpl, 'README.md'), join(wt, 'README.md'));
    copyFileSync(join(tpl, 'gitignore'), join(wt, '.gitignore'));
    writeFileSync(join(wt, 'package.json'), `${JSON.stringify(def.packageJson(mainPkg), null, 2)}\n`);
    git(wt, 'add', '-A');
    const changed = git(wt, 'status', '--porcelain') !== '';
    if (changed) {
      git(wt, 'commit', '-q', '-m', `${name} dalı: main ${mainSha} ile eşitlendi`);
      results.push(`${name}: güncellendi (${count + 3} dosya) → ${git(wt, 'rev-parse', '--short', 'HEAD')}`);
    } else {
      results.push(`${name}: değişiklik yok`);
    }
  } finally {
    git(root, 'worktree', 'remove', '--force', wt);
  }
}

for (const r of results) console.log(r);
if (push) {
  console.log(execFileSync('git', ['push', 'origin', 'mac', 'macClean'], { cwd: root, encoding: 'utf8' }));
} else {
  console.log('Göndermek için: git push origin mac macClean   (ya da --push ile)');
}
