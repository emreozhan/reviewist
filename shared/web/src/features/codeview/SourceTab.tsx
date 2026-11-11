import { useMemo } from 'react';
import type { FileChange, SymbolDecl } from '../../../../src/shared/types';
import { Icon } from '../../components/Icon';
import { StatusGlyph } from '../../components/StatusGlyph';
import { useFileContent, useOutline, useOutlineSupported } from '../../hooks/queries';
import { useHighlighted } from '../../hooks/useHighlighted';
import { langFor } from '../../lib/highlight';
import { findDeclarationLine } from '../../lib/locate';
import { crumbFor } from '../../lib/navTarget';
import type { ReviewIndex } from '../../lib/reviewIndex';
import { baseName, dirName } from '../../lib/reviewIndex';
import type { EditorTab } from '../../lib/tabs';
import { useLayout } from '../../state/layoutStore';
import { useTabs } from '../../state/tabsStore';
import { useCodeRefs } from '../codenav/useCodeRefs';
import { useReviewCtx } from '../workspace/ReviewContext';
import { SourceCode } from './SourceCode';
import type { OutlineItem } from './SourceOutline';
import { SourceOutline } from './SourceOutline';

const OUTLINE_KEY = 'src.outline';

function languageOfPath(path: string): FileChange['language'] {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, FileChange['language']> = { java: 'java', kt: 'kotlin', xml: 'xml', yml: 'yaml', yaml: 'yaml', properties: 'properties', sql: 'sql', gradle: 'gradle', json: 'json', md: 'markdown' };
  return map[ext] ?? 'other';
}

function itemsFromDecls(decls: readonly SymbolDecl[]): OutlineItem[] {
  const byId = new Map(decls.map((d) => [d.id, d]));
  const depthOf = (d: SymbolDecl): number => {
    let n = 0;
    let owner = d.ownerTypeId ? byId.get(d.ownerTypeId) : undefined;
    while (owner && n < 8) {
      n++;
      owner = owner.ownerTypeId ? byId.get(owner.ownerTypeId) : undefined;
    }
    return n;
  };
  return [...decls]
    .sort((a, b) => a.nameLine - b.nameLine)
    .map((d) => ({ id: d.id, label: d.kind === 'method' || d.kind === 'constructor' ? `${d.name}()` : d.name, kind: d.kind, line: d.nameLine, endLine: d.range.endLine, depth: depthOf(d), status: d.status }));
}

/** Sunucu ana hat vermezse: etki haritasında bu dosyaya ait (aralıklı) semboller. */
function itemsFromGraph(index: ReviewIndex, path: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const n of index.nodeById.values()) {
    if (n.file !== path || !n.range) continue;
    const isType = n.id === n.typeId;
    out.push({ id: n.id, label: isType ? n.label : n.label.slice(n.label.lastIndexOf('.') + 1), kind: n.kind, line: n.range.startLine, endLine: n.range.endLine, depth: isType ? 0 : 1 });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Diff dışı sınıfın salt okunur tam kaynağı: ana hat + kod; hedef metot vurgulu, referanslar tıklanabilir. */
export function SourceTab({ tab }: { tab: EditorTab }) {
  const { review, index } = useReviewCtx();
  const isJava = tab.path.endsWith('.java');
  const q = useFileContent(review.id, tab.path, tab.side);
  const lang = langFor(languageOfPath(tab.path));
  const hl = useHighlighted(q.content, lang);
  const refs = useCodeRefs(tab.path, tab.side, isJava);
  const outline = useOutline(review.id, tab.path, tab.side, isJava);
  const navSupported = useOutlineSupported();
  const outlineOpen = useLayout((s) => !s.closed[OUTLINE_KEY]);
  const setOpen = useLayout((s) => s.setOpen);

  const items = useMemo(() => (outline.data ? itemsFromDecls(outline.data.decls) : itemsFromGraph(index, tab.path)), [outline.data, index, tab.path]);
  const decl = tab.symbolId ? outline.data?.decls.find((d) => d.id === tab.symbolId) : undefined;
  const searched = !tab.line && !decl && tab.symbolId && q.lines ? findDeclarationLine(q.lines, tab.symbolId) : undefined;
  // Bildirim aralığı anotasyonları da içerir: aralığın başına (ad satırından önce) düşen odak ad satırına kaydırılır.
  const line = decl && (tab.line === undefined || (tab.line >= decl.range.startLine && tab.line <= decl.nameLine)) ? decl.nameLine : (tab.line ?? searched);
  const range = decl?.range ?? (tab.line && tab.endLine && tab.endLine >= tab.line ? { startLine: tab.line, endLine: tab.endLine } : undefined);
  const focus = useMemo(() => (line ? { line, tick: tab.tick } : null), [line, tab.tick]);

  const pick = (it: OutlineItem) => {
    useTabs.getState().focus(tab.key, { symbolId: it.id, line: it.line, endLine: it.endLine, crumb: crumbFor(index, it.id, it.label) });
  };

  const deleted = tab.side === 'old';
  return (
    <div className="sv">
      <div className="fhead sv-head">
        <div className="fhead__row">
          <StatusGlyph status={deleted ? 'removed' : 'impacted'} />
          <h2 className="fhead__path" title={tab.path}>
            <span className="fhead__dir">{dirName(tab.path)}/</span>
            <span className="fhead__base">{baseName(tab.path)}</span>
          </h2>
          <span className="tag tag--outside">{deleted ? 'eski sürüm' : 'diff dışı'}</span>
          <span className="fhead__spacer" />
          {isJava && (
            <button type="button" className={`btn btn--sm btn--ghost${outlineOpen ? ' is-on' : ''}`} aria-pressed={outlineOpen} onClick={() => setOpen(OUTLINE_KEY, !outlineOpen)} title="Sembol ana hattını göster/gizle">
              <Icon name="outline" /> Ana hat
            </button>
          )}
        </div>
        <p className="sv-head__banner" role="note">
          {deleted
            ? 'Bu sembol değişiklikle silindi — taban (eski) sürümün salt okunur kaynağı.'
            : 'Bu dosya bu değişiklikte değişmedi — etkilenen kod. Salt okunur tam kaynak (head).'}
          {line ? <span className="sv-head__line"> · satır {line}</span> : null}
          {isJava && navSupported && outline.isFetching && <span className="sv-head__muted" role="status"> · ana hat ve referanslar yükleniyor…</span>}
          {isJava && !navSupported && <span className="sv-head__muted"> · koddan gezinme bu sunucuda yok</span>}
        </p>
      </div>
      <div className={`sv__body${outlineOpen && isJava ? ' has-outline' : ''}`}>
        {outlineOpen && isJava && <SourceOutline items={items} activeId={tab.symbolId} onPick={pick} approximate={!outline.data} loading={outline.isFetching} />}
        <div className="sv__scroll">
          {q.isPending ? (
            <p className="center__note">Kaynak yükleniyor…</p>
          ) : q.isError ? (
            <p className="center__note">Kaynak alınamadı: {q.error.message}</p>
          ) : !q.lines ? (
            <p className="center__note">Dosya içeriği sunucudan alınamadı (kaynak içerik vermiyor ya da dosya bu tarafta yok: {tab.path}).</p>
          ) : (
            <SourceCode lines={q.lines} hl={hl} spans={refs.spans} focus={focus} range={range} label={`${tab.path} kaynağı (salt okunur)`} handlers={refs.handlers} />
          )}
        </div>
      </div>
      {refs.menu}
    </div>
  );
}
