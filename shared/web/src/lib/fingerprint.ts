import type { FileChange } from '../../../src/shared/types';

/** FNV-1a 32 bit (hızlı, kriptografik değil): metin → 8 haneli onaltılık. */
export function hash32(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Dosya değişikliğinin ucuz parmak izi: durum + eklenen/silinen satır sayıları + eklenen/silinen satır metinlerinin
 * 32 bit özeti. Satır numaraları girmez (dosyanın başka yerindeki kaymalar izi bozmaz); bağlam satırları da girmez.
 * "Görüldü" işaretiyle birlikte saklanır: dala yeni commit gelip dosyanın değişikliği farklılaşınca iz uyuşmaz.
 */
export function fileFingerprint(file: Pick<FileChange, 'status' | 'additions' | 'deletions' | 'hunks' | 'oldPath'>): string {
  let h = hash32(`${file.status}|${file.oldPath ?? ''}`);
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'context') continue;
      h = hash32(line.type === 'add' ? '+' : '-', h);
      h = hash32(line.text, h);
      h = hash32('\n', h);
    }
    h = hash32('@@', h);
  }
  return `${file.additions}/${file.deletions}/${h.toString(16).padStart(8, '0')}`;
}
