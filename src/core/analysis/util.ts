/**
 * Analiz modüllerinin ortak yardımcıları: risk seviyesi, sembol etiketleri, anotasyon ayrıştırma,
 * eşzamanlılık sınırlı map, diff satır kümeleri.
 */
import type { DiffHunk, RiskInfo, RiskLevel, RiskReason } from '../../shared/types.js';

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Skor → seviye: <20 low, <45 medium, <70 high, ≥70 critical. */
export function riskLevel(score: number): RiskLevel {
  if (score >= 70) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

export function maxLevel(levels: Iterable<RiskLevel>): RiskLevel {
  let best: RiskLevel = 'low';
  for (const l of levels) if (RISK_LEVEL_ORDER[l] > RISK_LEVEL_ORDER[best]) best = l;
  return best;
}

export function emptyRisk(): RiskInfo {
  return { score: 0, level: 'low', reasons: [] };
}

export function makeRisk(reasons: RiskReason[], scoreOverride?: number): RiskInfo {
  const raw = scoreOverride ?? reasons.reduce((s, r) => s + r.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, level: riskLevel(score), reasons };
}

/** Çift FQN'de modele eklenen '@kaynak kökü' sonekini atar ('a.B@android/src' → 'a.B'). */
function withoutRoot(fqn: string): string {
  const at = fqn.indexOf('@');
  return at < 0 ? fqn : fqn.slice(0, at);
}

/** 'com.acme.Outer.Inner' → 'Inner' ('@kök' soneki yok sayılır) */
export function simpleTypeName(fqn: string): string {
  const base = withoutRoot(fqn);
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1) : base;
}

export function packageOf(fqn: string): string {
  const base = withoutRoot(fqn);
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(0, i) : '';
}

/** Okunur etiket: 'com.acme.OrderService#place(Order,int)' → 'OrderService.place', tip → basit ad. */
export function symbolLabel(id: string): string {
  const i = id.indexOf('#');
  if (i < 0) return simpleTypeName(id);
  const owner = simpleTypeName(id.slice(0, i));
  const rest = id.slice(i + 1);
  const p = rest.indexOf('(');
  const name = p >= 0 ? rest.slice(0, p) : rest.split('#')[0];
  return `${owner}.${name}`;
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/** Anotasyon metninden ad: '@org.x.Transactional(readOnly = true)' → 'Transactional'. */
export function annotationName(annotation: string): string {
  const s = annotation.trim().replace(/^@/, '');
  const m = /^[\w.$]+/.exec(s);
  const full = m ? m[0] : s;
  return simpleTypeName(full);
}

/**
 * Kaynak metindeki anotasyonları argümanlarıyla birlikte çıkarır ('@Size(max = 10)').
 * Boşluklar normalize edilir. '@interface' ve küçük harfle başlayan (e-posta vb.) eşleşmeler atlanır.
 */
export function extractAnnotations(text: string): string[] {
  const out: string[] = [];
  const re = /@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const qualified = m[1];
    if (qualified === 'interface') continue;
    const name = simpleTypeName(qualified);
    if (!/^[A-Z]/.test(name)) continue;
    let end = re.lastIndex;
    let j = end;
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
    let args = '';
    if (text[j] === '(') {
      let depth = 0;
      let k = j;
      let quote: string | undefined;
      for (; k < text.length; k++) {
        const c = text[k];
        if (quote) {
          if (c === '\\') k++;
          else if (c === quote) quote = undefined;
          continue;
        }
        if (c === '"' || c === "'") quote = c;
        else if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      args = text.slice(j, k + 1).replace(/\s+/g, ' ');
      end = k + 1;
      re.lastIndex = end;
    }
    out.push(`@${name}${args}`);
  }
  return out;
}

/** Sınırlı eşzamanlılıkla map; sonuç sırası girdiyle aynı. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let w = 0; w < n; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          results[i] = await fn(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

/**
 * Sayısal ilerleme bildirici: toplamın ~%10'unda bir (ve sonda) mesaj üretir; küçük toplamlarda her adımda.
 * `tick()` bir öğe tamamlandığında çağrılır. `start` verilirse sayaç oradan başlar (ör. zaten hazır olanlar).
 */
export function progressCounter(emit: (msg: string) => void, total: number, label: (done: number, total: number) => string, start = 0): { tick(): void } {
  const step = Math.max(1, Math.ceil(total / 10));
  let done = start;
  let lastEmitted = -1;
  if (total > 0) {
    emit(label(done, total));
    lastEmitted = done;
  }
  return {
    tick() {
      done++;
      if (done === lastEmitted) return;
      if (done >= total || done - lastEmitted >= step) {
        emit(label(Math.min(done, total), total));
        lastEmitted = done;
      }
    },
  };
}

/** Hunk'lardan eklenen (yeni satır no) ve silinen (eski satır no) satır kümeleri. */
export function changedLineSets(hunks: readonly DiffHunk[]): { added: Set<number>; removed: Set<number> } {
  const added = new Set<number>();
  const removed = new Set<number>();
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.type === 'add' && l.newNo !== undefined) added.add(l.newNo);
      else if (l.type === 'del' && l.oldNo !== undefined) removed.add(l.oldNo);
    }
  }
  return { added, removed };
}

/** Bir regex'in metindeki eşleşme sayısı (g bayrağı eklenir). */
export function countMatches(text: string | undefined, re: RegExp): number {
  if (!text) return 0;
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let n = 0;
  while (g.exec(text) !== null) n++;
  return n;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** İkili yığın (min-heap; `less(a, b)` a önce gelmeli ise true). push/pop O(log n). */
export class BinaryHeap<T> {
  private readonly items: T[] = [];
  constructor(private readonly less: (a: T, b: T) => boolean) {}
  get size(): number {
    return this.items.length;
  }
  push(item: T): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop() as T;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
