/**
 * Vitest genel kurulumu (tüm test işçilerinden önce, bir kez):
 *  1. git'i kullanıcının ve sistemin yapılandırmasından yalıtır: imzalı commit, global gitignore (`out/` gibi),
 *     autocrlf, hook yolu vb. ayarlar testleri makineden makineye farklı davrandırmasın.
 *  2. Fikstür deposu (`fixtures/sample-repo`) yoksa üretir; böylece temiz bir klonda fikstür testleri atlanmaz.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'reviewist-test-gitconfig-'));
  const emptyConfig = join(dir, 'gitconfig');
  writeFileSync(emptyConfig, '');
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_AUTHOR_NAME ??= 'Test';
  process.env.GIT_AUTHOR_EMAIL ??= 'test@example.com';
  process.env.GIT_COMMITTER_NAME ??= 'Test';
  process.env.GIT_COMMITTER_EMAIL ??= 'test@example.com';

  const fixture = join(root, 'fixtures', 'sample-repo');
  if (!existsSync(join(fixture, '.git'))) {
    console.log('[vitest] fixtures/sample-repo yok; üretiliyor (node scripts/make-fixture.mjs)…');
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'make-fixture.mjs')], { cwd: root, stdio: 'inherit' });
    } catch (err) {
      console.warn(`[vitest] Fikstür üretilemedi; fikstür testleri atlanacak: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
