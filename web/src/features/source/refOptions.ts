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

export type RefKind = 'branch' | 'remote' | 'tag' | 'commit' | 'custom';

export const REF_KIND_LABEL: Record<RefKind, string> = {
  branch: 'dal',
  remote: 'uzak dal',
  tag: 'etiket',
  commit: 'commit',
  custom: 'özel ref',
};

/** Seçili değerin türü ve gösterim metni (commit ise kısa SHA + konu). */
export function describeRef(refs: GitRefs | undefined, value: string): { kind: RefKind; label: string } {
  const v = value.trim();
  if (refs?.branches.includes(v)) return { kind: 'branch', label: v };
  if (refs?.remoteBranches.includes(v)) return { kind: 'remote', label: v };
  if (refs?.tags.includes(v)) return { kind: 'tag', label: v };
  const commit = /^[0-9a-f]{7,40}$/i.test(v) ? refs?.recentCommits.find((c) => c.sha.startsWith(v.toLowerCase())) : undefined;
  if (commit) return { kind: 'commit', label: `${commit.sha.slice(0, 7)} ${commit.subject}` };
  return { kind: 'custom', label: v };
}

export interface RefRow extends RefOption {
  key: string;
  /** 'custom': yazılan metni olduğu gibi kullan; 'empty': değeri boşalt. */
  special?: 'custom' | 'empty';
}

/**
 * Açılır listedeki satırlar: (varsa) değeri boşaltan seçenek, yazılan metin hiçbir ref'le birebir eşleşmiyorsa
 * "olduğu gibi kullan" satırı, ardından sorguya göre süzülmüş gruplu ref'ler.
 */
export function buildRefRows(refs: GitRefs | undefined, query: string, emptyOption?: string): RefRow[] {
  const q = query.trim();
  const options = filterRefOptions(buildRefOptions(refs), q, 300);
  const rows: RefRow[] = [];
  if (emptyOption && !q) rows.push({ key: 'empty', value: '', label: emptyOption, group: '', special: 'empty' });
  if (q && !options.some((o) => o.value === q)) {
    rows.push({ key: `custom:${q}`, value: q, label: q, group: '', meta: 'Bu ref adını olduğu gibi kullan', special: 'custom' });
  }
  for (const o of options) rows.push({ ...o, key: `${o.group}:${o.value}` });
  return rows;
}

/** Head önerisi: tabandan farklıysa geçerli dal, değilse tabandan farklı en son commit almış dal. */
export function suggestHead(refs: GitRefs, base: string): string {
  if (refs.currentBranch && refs.currentBranch !== base) return refs.currentBranch;
  const ordered = refs.recentBranches ?? refs.branches;
  return ordered.find((b) => b !== base) ?? refs.currentBranch ?? '';
}

export function filterRefOptions(options: RefOption[], query: string, limit = 60): RefOption[] {
  const q = query.trim().toLowerCase();
  const list = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().startsWith(q)) : options;
  return list.slice(0, limit);
}
