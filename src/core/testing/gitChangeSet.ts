/**
 * YALNIZCA TEST İÇİN: git deposundan basit ChangeSet (`git diff --name-status`, `git show`, `git ls-tree`).
 * Asıl git kaynağı src/sources altındadır. Hunk'lar memoryChangeSet ile üretilir.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChangeSet } from '../../shared/types.js';
import { createMemoryChangeSet } from './memoryChangeSet.js';

const run = promisify(execFile);

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', repo, ...args], { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
  return stdout;
}

async function show(repo: string, rev: string, path: string): Promise<string | undefined> {
  try {
    return await git(repo, ['show', `${rev}:${path}`]);
  } catch {
    return undefined;
  }
}

/** base...head (merge-base) farkından ChangeSet kurar. */
export async function createGitTestChangeSet(repo: string, base: string, head: string): Promise<ChangeSet> {
  const mergeBase = (await git(repo, ['merge-base', base, head])).trim();
  const status = await git(repo, ['diff', '--name-status', '-M', mergeBase, head]);
  const oldFiles: Record<string, string> = {};
  const newFiles: Record<string, string> = {};
  const renames: Record<string, string> = {};
  for (const line of status.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0][0];
    if (code === 'R' || code === 'C') {
      const [, from, to] = parts;
      oldFiles[from] = (await show(repo, mergeBase, from)) ?? '';
      newFiles[to] = (await show(repo, head, to)) ?? '';
      if (code === 'R') renames[to] = from;
    } else if (code === 'A') {
      newFiles[parts[1]] = (await show(repo, head, parts[1])) ?? '';
    } else if (code === 'D') {
      oldFiles[parts[1]] = (await show(repo, mergeBase, parts[1])) ?? '';
    } else {
      oldFiles[parts[1]] = (await show(repo, mergeBase, parts[1])) ?? '';
      newFiles[parts[1]] = (await show(repo, head, parts[1])) ?? '';
    }
  }
  const mem = createMemoryChangeSet({
    old: oldFiles,
    new: newFiles,
    renames,
    info: { kind: 'git', title: `${base}...${head}`, repoPath: repo, baseRef: base, headRef: head, baseSha: mergeBase },
  });
  const all = (await git(repo, ['ls-tree', '-r', '--name-only', head])).split('\n').filter(Boolean).sort();
  return {
    info: mem.info,
    files: mem.files,
    readFile: (side, path) => show(repo, side === 'old' ? mergeBase : head, path),
    listFiles: async (_side, ext) => (ext ? all.filter((p) => p.endsWith(ext)) : all),
  };
}
