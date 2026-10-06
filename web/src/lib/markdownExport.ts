import type { ReviewModel } from '../../../src/shared/types';
import type { PersistedReviewState } from './persistence';
import type { ReviewIndex } from './reviewIndex';
import { symbolLabel } from './reviewIndex';
import { orderedEntries } from './selectors';

const SEVERITY_TR = { error: 'Hata', warning: 'Uyarı', info: 'Bilgi' } as const;

function shortSha(sha?: string): string {
  return sha ? sha.slice(0, 7) : '';
}

function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

/** Notları, ilerlemeyi ve açık önemli bulguları inceleme yorumu olarak yapıştırılabilir Markdown'a çevirir. */
export function buildMarkdown(review: ReviewModel, index: ReviewIndex, state: PersistedReviewState): string {
  const s = review.source;
  const entries = orderedEntries(review, index);
  const seenCount = entries.filter((e) => state.seen[e.file.id]).length;
  const out: string[] = [];
  out.push(`# İnceleme notları: ${s.title}`);
  out.push('');
  const refs = `\`${s.baseRef}${s.baseSha ? ` (${shortSha(s.baseSha)})` : ''}\` → \`${s.headRef}${s.headSha ? ` (${shortSha(s.headSha)})` : ''}\``;
  out.push(`- Karşılaştırma: ${refs}`);
  if (s.prUrl) out.push(`- PR: ${s.prUrl}${s.author ? ` (yazar: ${s.author})` : ''}`);
  out.push(`- İlerleme: ${seenCount}/${entries.length} dosya görüldü`);
  out.push('');

  let noteCount = 0;
  const fileSections: string[] = [];
  const used = new Set<string>();
  for (const { file } of entries) {
    const lines: string[] = [];
    const fileNote = state.notes[`file:${file.path}`];
    used.add(`file:${file.path}`);
    if (fileNote?.trim()) lines.push(quote(fileNote));
    const symbolIds = new Set<string>();
    for (const typeId of file.typeIds) {
      symbolIds.add(typeId);
      for (const m of index.typeById.get(typeId)?.members ?? []) symbolIds.add(m.id);
    }
    for (const id of symbolIds) {
      const note = state.notes[`sym:${id}`];
      used.add(`sym:${id}`);
      if (!note?.trim()) continue;
      const member = index.memberById.get(id);
      const line = member?.newRange?.startLine ?? member?.oldRange?.startLine;
      lines.push(`- **\`${symbolLabel(index, id)}\`**${line ? ` (satır ${line})` : ''}`);
      lines.push(note.trim().split('\n').map((l) => `  ${l}`).join('\n'));
    }
    if (lines.length === 0) continue;
    noteCount += lines.length;
    fileSections.push(`### \`${file.path}\``, '', ...lines, '');
  }
  // Diff dışı sembollere (etkilenen çağıranlar, alt tipler…) ve bu incelemede artık olmayan dosyalara yazılan notlar.
  const outside = Object.entries(state.notes)
    .filter(([k, v]) => !used.has(k) && v.trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const outsideLines: string[] = [];
  for (const [k, v] of outside) {
    const label = k.startsWith('sym:') ? symbolLabel(index, k.slice(4)) : k.startsWith('file:') ? k.slice(5) : k;
    outsideLines.push(`- **\`${label}\`**`, v.trim().split('\n').map((l) => `  ${l}`).join('\n'));
  }

  out.push('## Notlar');
  out.push('');
  if (noteCount === 0 && outsideLines.length === 0) out.push('_Henüz not yok._', '');
  else out.push(...fileSections);
  if (outsideLines.length > 0) out.push('## Diff dışı notlar', '', ...outsideLines, '');

  const important = review.findings.filter((f) => f.severity !== 'info');
  if (important.length > 0) {
    out.push('## Dikkat gerektiren bulgular');
    out.push('');
    for (const f of important) {
      const loc = f.file ? ` — \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
      out.push(`- **${SEVERITY_TR[f.severity]}:** ${f.title}${loc}`);
    }
    out.push('');
  }

  const unseen = entries.filter((e) => !state.seen[e.file.id] && !e.file.cosmeticOnly);
  if (unseen.length > 0) {
    out.push('## Henüz görülmeyen dosyalar');
    out.push('');
    for (const e of unseen) out.push(`- [ ] \`${e.file.path}\``);
    out.push('');
  }
  return out.join('\n');
}
