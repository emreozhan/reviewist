import type { GitRefs } from '../../../../src/shared/types';

export interface RefOption {
  value: string;
  label: string;
  group: string;
  meta?: string;
}

export function buildRefOptions(refs: GitRefs | undefined): RefOption[] {
  if (!refs) return [];
  const out: RefOption[] = [];
  for (const b of refs.branches) {
    const tags = [b === refs.currentBranch ? 'geçerli' : '', b === refs.defaultBase ? 'varsayılan taban' : ''].filter(Boolean).join(' · ');
    out.push({ value: b, label: b, group: 'Dallar', meta: tags || undefined });
  }
  for (const b of refs.remoteBranches) out.push({ value: b, label: b, group: 'Uzak dallar' });
  for (const t of refs.tags) out.push({ value: t, label: t, group: 'Etiketler' });
  for (const c of refs.recentCommits) {
    out.push({ value: c.sha, label: `${c.sha.slice(0, 7)} ${c.subject}`, group: 'Son commitler', meta: `${c.author} · ${c.date.slice(0, 10)}` });
  }
  return out;
}

/** Değer bu repoda anlamlı bir ref mi: dal/uzak dal/etiket, HEAD ifadesi ya da commit SHA'sı gibi görünen metin. */
export function isKnownRef(refs: GitRefs, value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^HEAD([~^]\d*)*$/.test(v) || /^[0-9a-f]{7,40}$/i.test(v)) return true;
  return refs.branches.includes(v) || refs.remoteBranches.includes(v) || refs.tags.includes(v);
}

export function filterRefOptions(options: RefOption[], query: string, limit = 60): RefOption[] {
  const q = query.trim().toLowerCase();
  const list = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().startsWith(q)) : options;
  return list.slice(0, limit);
}
