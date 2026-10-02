/**
 * Unified diff ayrıştırıcı: git biçimi (`diff --git` + genişletilmiş başlıklar), düz patch (`---`/`+++`),
 * GitHub API `patch` alanı (yalnız hunk'lar). Girdi CRLF olabilir.
 */
import type { ChangeSetFile, DiffHunk, DiffLine, FileStatus } from '../shared/types.js';

/** Ayrıştırılmış dosya + hunk'ların ham satırları (işaretli; `\ No newline` dahil). patch.ts ters uygulama için kullanır. */
export interface ParsedDiffFile {
  file: ChangeSetFile;
  rawHunks: RawHunk[];
}

export interface RawHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** ' ', '+', '-' ya da '\' ile başlayan satırlar. */
  lines: string[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

// ---------------------------------------------------------------------------
// Yol yardımcıları
// ---------------------------------------------------------------------------

const C_ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '"': 0x22,
  '\\': 0x5c,
};

/**
 * `s[start]` bir çift tırnak olmalı. Git'in C tarzı kaçışlı yolunu (oktal UTF-8 baytları dahil) çözer.
 * Dönüş: çözülmüş metin ve kapanış tırnağından sonraki indeks; geçersizse undefined.
 */
function readQuoted(s: string, start: number): { value: string; end: number } | undefined {
  if (s[start] !== '"') return undefined;
  const bytes: number[] = [];
  let i = start + 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      return { value: Buffer.from(bytes).toString('utf8'), end: i + 1 };
    }
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === undefined) return undefined;
      if (/[0-7]/.test(next)) {
        let oct = '';
        let j = i + 1;
        while (j < s.length && oct.length < 3 && /[0-7]/.test(s[j] ?? '')) {
          oct += s[j];
          j++;
        }
        bytes.push(parseInt(oct, 8) & 0xff);
        i = j;
        continue;
      }
      const code = C_ESCAPES[next];
      bytes.push(code ?? next.charCodeAt(0));
      i += 2;
      continue;
    }
    for (const b of Buffer.from(ch ?? '', 'utf8')) bytes.push(b);
    i++;
  }
  return undefined;
}

/** Tırnaklıysa çözer, değilse olduğu gibi döner. */
export function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    const q = readQuoted(trimmed, 0);
    if (q) return q.value;
  }
  return trimmed;
}

function stripPrefix(p: string, prefix: 'a/' | 'b/'): string {
  return p.startsWith(prefix) ? p.slice(2) : p;
}

/** `--- a/x\t2024-01-01 ...` gibi satırlardan yolu çıkarır (zaman damgasını atar). */
function parseFileHeaderPath(rest: string): string {
  const trimmed = rest.replace(/\s+$/, '');
  if (trimmed.startsWith('"')) {
    const q = readQuoted(trimmed, 0);
    if (q) return q.value;
  }
  const tab = trimmed.indexOf('\t');
  return tab >= 0 ? trimmed.slice(0, tab) : trimmed;
}

/** `diff --git a/x b/y` satırındaki iki yolu (önekleriyle) ayrıştırır. */
function parseDiffGitPaths(rest: string): { a?: string; b?: string } {
  if (rest.startsWith('"')) {
    const first = readQuoted(rest, 0);
    if (!first) return {};
    const remaining = rest.slice(first.end).trimStart();
    const second = remaining.startsWith('"') ? readQuoted(remaining, 0)?.value : remaining;
    return { a: first.value, b: second };
  }
  // İkinci yol tırnaklı olabilir: `a/x "b/ç y"`
  const qIdx = rest.indexOf(' "');
  if (qIdx >= 0 && rest.endsWith('"')) {
    const second = readQuoted(rest, qIdx + 1);
    if (second && second.end === rest.length) return { a: rest.slice(0, qIdx), b: second.value };
  }
  // İki yol aynıysa (en yaygın durum) tam ortadan bölünür; boşluklu adlarda da çalışır.
  const len = rest.length;
  if (len % 2 === 1) {
    const mid = (len - 1) / 2;
    const a = rest.slice(0, mid);
    const b = rest.slice(mid + 1);
    if (rest[mid] === ' ' && stripPrefix(a, 'a/') === stripPrefix(b, 'b/')) return { a, b };
  }
  const bIdx = rest.indexOf(' b/');
  if (bIdx >= 0) return { a: rest.slice(0, bIdx), b: rest.slice(bIdx + 1) };
  const sp = rest.indexOf(' ');
  if (sp >= 0) return { a: rest.slice(0, sp), b: rest.slice(sp + 1) };
  return { a: rest, b: rest };
}

// ---------------------------------------------------------------------------
// Hunk ayrıştırma
// ---------------------------------------------------------------------------

interface HunkParseResult {
  hunk: DiffHunk;
  raw: RawHunk;
  next: number; // işlenmemiş ilk satır indeksi
}

/** `lines[start]` bir `@@` başlığı olmalı. Sayaçlara göre hunk gövdesini tüketir. */
function parseHunkAt(lines: string[], start: number): HunkParseResult | undefined {
  const m = HUNK_RE.exec(lines[start] ?? '');
  if (!m) return undefined;
  const oldStart = Number(m[1]);
  const oldLines = m[2] === undefined ? 1 : Number(m[2]);
  const newStart = Number(m[3]);
  const newLines = m[4] === undefined ? 1 : Number(m[4]);
  const hunk: DiffHunk = { oldStart, oldLines, newStart, newLines, header: (m[5] ?? '').trim(), lines: [] };
  const raw: RawHunk = { oldStart, oldLines, newStart, newLines, lines: [] };

  let oldRemaining = oldLines;
  let newRemaining = newLines;
  let oldNo = oldStart;
  let newNo = newStart;
  let i = start + 1;

  while (i < lines.length && (oldRemaining > 0 || newRemaining > 0)) {
    const line = lines[i] ?? '';
    const sign = line[0];
    if (sign === '\\') {
      raw.lines.push(line);
      i++;
      continue;
    }
    let dl: DiffLine;
    if (sign === ' ' || line === '') {
      // Bazı araçlar boş bağlam satırının baştaki boşluğunu siler.
      if (oldRemaining <= 0 || newRemaining <= 0) break;
      dl = { type: 'context', oldNo, newNo, text: line.slice(1) };
      raw.lines.push(` ${line.slice(1)}`);
      oldNo++;
      newNo++;
      oldRemaining--;
      newRemaining--;
    } else if (sign === '-') {
      if (oldRemaining <= 0) break;
      dl = { type: 'del', oldNo, text: line.slice(1) };
      raw.lines.push(line);
      oldNo++;
      oldRemaining--;
    } else if (sign === '+') {
      if (newRemaining <= 0) break;
      dl = { type: 'add', newNo, text: line.slice(1) };
      raw.lines.push(line);
      newNo++;
      newRemaining--;
    } else {
      break; // beklenmeyen satır: hunk kesik
    }
    hunk.lines.push(dl);
    i++;
  }
  // Son satırdan sonra gelen `\ No newline at end of file`
  if (i < lines.length && (lines[i] ?? '').startsWith('\\')) {
    raw.lines.push(lines[i] ?? '');
    i++;
  }
  return { hunk, raw, next: i };
}

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (l.endsWith('\r')) lines[i] = l.slice(0, -1);
  }
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** GitHub API `patch` alanı gibi yalnız hunk içeren metni ayrıştırır. */
export function parseHunks(patch: string): DiffHunk[] {
  if (!patch) return [];
  const lines = splitLines(patch);
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] ?? '').startsWith('@@ ')) {
      const r = parseHunkAt(lines, i);
      if (r) {
        hunks.push(r.hunk);
        i = Math.max(r.next, i + 1);
        continue;
      }
    }
    i++;
  }
  return hunks;
}

// ---------------------------------------------------------------------------
// Dosya düzeyi ayrıştırma
// ---------------------------------------------------------------------------

interface FileBuilder {
  isGit: boolean;
  gitA?: string;
  gitB?: string;
  minusPath?: string; // '---' satırı (önek dahil)
  plusPath?: string; // '+++' satırı (önek dahil)
  renameFrom?: string;
  renameTo?: string;
  copyFrom?: string;
  copyTo?: string;
  newFile: boolean;
  deletedFile: boolean;
  binary: boolean;
  hunks: DiffHunk[];
  rawHunks: RawHunk[];
}

function newBuilder(isGit: boolean): FileBuilder {
  return { isGit, newFile: false, deletedFile: false, binary: false, hunks: [], rawHunks: [] };
}

const DEV_NULL = '/dev/null';

function finish(b: FileBuilder): ParsedDiffFile | undefined {
  let oldPath: string | undefined;
  let newPath: string | undefined;

  const minus = b.minusPath;
  const plus = b.plusPath;
  const minusIsNull = minus === DEV_NULL;
  const plusIsNull = plus === DEV_NULL;

  if (minus !== undefined || plus !== undefined) {
    // Önekler: git'te her zaman a/ b/; düz patch'te ancak ikisi birlikte varsa soyulur.
    const stripBoth =
      b.isGit ||
      ((minusIsNull || (minus ?? '').startsWith('a/')) && (plusIsNull || (plus ?? '').startsWith('b/')));
    if (minus !== undefined && !minusIsNull) oldPath = stripBoth ? stripPrefix(minus, 'a/') : minus;
    if (plus !== undefined && !plusIsNull) newPath = stripBoth ? stripPrefix(plus, 'b/') : plus;
  }
  if (b.isGit) {
    const ga = b.gitA !== undefined ? stripPrefix(b.gitA, 'a/') : undefined;
    const gb = b.gitB !== undefined ? stripPrefix(b.gitB, 'b/') : undefined;
    if (oldPath === undefined && !minusIsNull && !b.newFile) oldPath = ga;
    if (newPath === undefined && !plusIsNull && !b.deletedFile) newPath = gb;
  }
  if (b.renameFrom !== undefined) oldPath = b.renameFrom;
  if (b.renameTo !== undefined) newPath = b.renameTo;
  if (b.copyFrom !== undefined) oldPath = b.copyFrom;
  if (b.copyTo !== undefined) newPath = b.copyTo;

  let status: FileStatus;
  if (b.renameFrom !== undefined || b.renameTo !== undefined) status = 'renamed';
  else if (b.copyFrom !== undefined || b.copyTo !== undefined) status = 'copied';
  else if (b.newFile || (minusIsNull && !plusIsNull)) status = 'added';
  else if (b.deletedFile || (plusIsNull && !minusIsNull)) status = 'deleted';
  else status = 'modified';

  const path = status === 'deleted' ? (oldPath ?? newPath) : (newPath ?? oldPath);
  if (path === undefined || path === '') return undefined;

  let additions = 0;
  let deletions = 0;
  for (const h of b.hunks) {
    for (const l of h.lines) {
      if (l.type === 'add') additions++;
      else if (l.type === 'del') deletions++;
    }
  }

  const file: ChangeSetFile = {
    path,
    status,
    binary: b.binary,
    additions,
    deletions,
    hunks: b.hunks,
  };
  if ((status === 'renamed' || status === 'copied') && oldPath !== undefined) file.oldPath = oldPath;
  return { file, rawHunks: b.rawHunks };
}

/** Ayrıntılı ayrıştırma: dosyalar + ham hunk satırları. */
export function parseUnifiedDiffDetailed(text: string): ParsedDiffFile[] {
  if (!text || text.trim() === '') return [];
  const lines = splitLines(text);
  const out: ParsedDiffFile[] = [];
  let cur: FileBuilder | undefined;
  // `diff --git` başlık bölümündeyiz (hunk'lar başlamadı)
  let inGitHeader = false;

  const flush = (): void => {
    if (cur) {
      const f = finish(cur);
      if (f) out.push(f);
    }
    cur = undefined;
    inGitHeader = false;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('diff --git ')) {
      flush();
      cur = newBuilder(true);
      const { a, b } = parseDiffGitPaths(line.slice('diff --git '.length));
      cur.gitA = a;
      cur.gitB = b;
      inGitHeader = true;
      i++;
      continue;
    }

    if (cur && inGitHeader) {
      if (line.startsWith('new file mode')) cur.newFile = true;
      else if (line.startsWith('deleted file mode')) cur.deletedFile = true;
      else if (line.startsWith('rename from ')) cur.renameFrom = unquoteGitPath(line.slice(12));
      else if (line.startsWith('rename to ')) cur.renameTo = unquoteGitPath(line.slice(10));
      else if (line.startsWith('rename old ')) cur.renameFrom = unquoteGitPath(line.slice(11));
      else if (line.startsWith('rename new ')) cur.renameTo = unquoteGitPath(line.slice(11));
      else if (line.startsWith('copy from ')) cur.copyFrom = unquoteGitPath(line.slice(10));
      else if (line.startsWith('copy to ')) cur.copyTo = unquoteGitPath(line.slice(8));
      else if (line.startsWith('Binary files ') && line.endsWith(' differ')) cur.binary = true;
      else if (line === 'GIT binary patch') {
        cur.binary = true;
        i++;
        // base85 veri bloklarını atla: sonraki `diff --git` satırına kadar
        while (i < lines.length && !(lines[i] ?? '').startsWith('diff --git ')) i++;
        flush();
        continue;
      } else if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
        cur.minusPath = parseFileHeaderPath(line.slice(4));
        cur.plusPath = parseFileHeaderPath((lines[i + 1] ?? '').slice(4));
        i += 2;
        inGitHeader = false;
        continue;
      } else if (line.startsWith('@@ ')) {
        inGitHeader = false;
        continue; // aşağıdaki hunk dalı işler
      }
      // old mode / new mode / index / similarity index / dissimilarity index: bilgi amaçlı
      i++;
      continue;
    }

    if (line.startsWith('@@ ') && cur) {
      const r = parseHunkAt(lines, i);
      if (r) {
        cur.hunks.push(r.hunk);
        cur.rawHunks.push(r.raw);
        i = Math.max(r.next, i + 1);
        continue;
      }
    }

    // Düz patch: `--- x` ardından `+++ y`
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      flush();
      cur = newBuilder(false);
      cur.minusPath = parseFileHeaderPath(line.slice(4));
      cur.plusPath = parseFileHeaderPath((lines[i + 1] ?? '').slice(4));
      i += 2;
      continue;
    }

    // Diğer satırlar (commit mesajı, `index`, `Only in` vb.) yok sayılır.
    i++;
  }
  flush();
  return out;
}

/** Unified diff metnini dosya listesine çevirir. Boş diff → []. */
export function parseUnifiedDiff(text: string): ChangeSetFile[] {
  return parseUnifiedDiffDetailed(text).map((p) => p.file);
}

/** Bir dosyanın tam içeriğinden "tamamen eklendi" hunk'ı üretir (izlenmeyen dosyalar için). */
export function hunksForAddedContent(content: string): { hunks: DiffHunk[]; additions: number } {
  if (content === '') return { hunks: [], additions: 0 };
  const normalized = content.replace(/\r\n/g, '\n');
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  const parts = body.split('\n');
  const lines: DiffLine[] = parts.map((text, idx) => ({ type: 'add', newNo: idx + 1, text }));
  return {
    hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: parts.length, header: '', lines }],
    additions: parts.length,
  };
}
