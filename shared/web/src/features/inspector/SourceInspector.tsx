import { useMemo } from 'react';
import type { ImpactNodeStatus, SymbolDecl } from '../../../../src/shared/types';
import { Section } from '../../components/Section';
import { StatusGlyph } from '../../components/StatusGlyph';
import { SymbolLink } from '../../components/SymbolLink';
import { useOutline } from '../../hooks/queries';
import { KIND_LABEL } from '../../lib/labels';
import { symbolNoteKey } from '../../lib/persistence';
import type { ReviewIndex } from '../../lib/reviewIndex';
import { baseName, findAnchor, shortId, symbolLabel } from '../../lib/reviewIndex';
import type { EditorTab } from '../../lib/tabs';
import { useReviewCtx } from '../workspace/ReviewContext';
import { NoteEditor } from './NoteEditor';

interface Link {
  id: string;
  status?: ImpactNodeStatus;
}

function changedStatus(index: ReviewIndex, id: string): ImpactNodeStatus | undefined {
  const s = index.memberById.get(id)?.status ?? index.typeById.get(id)?.status;
  return s && s !== 'unchanged' ? s : undefined;
}

/** Diff dışı sembolün değişen kodla bağları: çağırdığı, override ettiği, alt tipi olduğu değişen semboller. */
function relations(index: ReviewIndex, symbolId: string | undefined, typeId: string | undefined) {
  const calls: Link[] = [];
  const overrides: Link[] = [];
  const supers: Link[] = [];
  for (const t of index.typeById.values()) {
    if (typeId && t.subTypes.includes(typeId) && t.status !== 'unchanged') supers.push({ id: t.id, status: t.status });
    if (!symbolId) continue;
    for (const m of t.members) {
      if (m.status === 'unchanged') continue;
      if (m.callers.some((c) => c.fromId === symbolId)) calls.push({ id: m.id, status: m.status });
      if (m.overriddenBy.includes(symbolId)) overrides.push({ id: m.id, status: m.status });
    }
  }
  return { calls, overrides, supers };
}

function LinkList({ title, items }: { title: string; items: Link[] }) {
  const { index } = useReviewCtx();
  if (items.length === 0) return null;
  return (
    <div className="srel">
      <p className="srel__title">{title}</p>
      <ul className="srel__list">
        {items.map((l) => (
          <li key={l.id}>
            <SymbolLink id={l.id} label={symbolLabel(index, l.id)} status={l.status} detail={index.memberById.get(l.id)?.signature} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Diff dışı (Kaynak görünümlü) sekmenin denetçisi: neden etkilendiği ve değişen koda giden bağlantılar. */
export function SourceInspector({ tab }: { tab: EditorTab }) {
  const { review, index } = useReviewCtx();
  const outline = useOutline(review.id, tab.path, tab.side);
  const decls = outline.data?.decls ?? [];
  const decl: SymbolDecl | undefined = tab.symbolId ? decls.find((d) => d.id === tab.symbolId) : undefined;
  const typeDecl = decls.find((d) => d.id === tab.typeId) ?? decls.find((d) => !d.ownerTypeId);
  const subjectId = tab.symbolId ?? typeDecl?.id ?? tab.typeId;
  const node = subjectId ? index.nodeById.get(subjectId) : undefined;
  const kind = decl?.kind ?? node?.kind ?? typeDecl?.kind;
  const rel = useMemo(() => relations(index, tab.symbolId, tab.typeId ?? typeDecl?.id), [index, tab.symbolId, tab.typeId, typeDecl?.id]);
  const anchor = (tab.symbolId && findAnchor(index, tab.symbolId)) || (tab.typeId && findAnchor(index, tab.typeId)) || undefined;

  // Bu sembolün gövdesinden değişen koda giden çağrılar (outline referanslarından).
  const outgoing = useMemo(() => {
    const range = (decl ?? typeDecl)?.range;
    if (!range || !outline.data) return [];
    // Zaten "Çağırdığı değişen semboller"de olanlar tekrar listelenmez.
    const seen = new Set<string>(rel.calls.map((c) => c.id));
    const out: Link[] = [];
    for (const r of outline.data.refs) {
      if (r.line < range.startLine || r.line > range.endLine) continue;
      for (const id of r.targets) {
        const status = changedStatus(index, id);
        if (!status || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, status });
      }
    }
    return out;
  }, [decl, typeDecl, outline.data, index, rel.calls]);

  const name = decl?.name ?? (subjectId ? symbolLabel(index, subjectId) : baseName(tab.path));
  const totalLinks = rel.calls.length + rel.overrides.length + rel.supers.length + outgoing.length;

  return (
    <div className="insp__content">
      <header className="insp__subject">
        <p className="insp__kind">
          {kind ? KIND_LABEL[kind] : 'dosya'}
          {typeDecl && decl && decl.id !== typeDecl.id && <> · <span className="insp__owner">{typeDecl.name}</span></>}
        </p>
        <h2 className="insp__name">{name}</h2>
        <p className="insp__where">
          <StatusGlyph status={tab.side === 'old' ? 'removed' : 'impacted'} withLabel />
          <span className="insp__file gauge" title={tab.path}>
            {baseName(tab.path)}
            {tab.line ? `:${tab.line}` : ''}
          </span>
        </p>
        <p className="insp__outside-note">
          {tab.side === 'old' ? 'Bu sembol değişiklikle silindi; taban (eski) sürüm gösteriliyor.' : 'Bu dosya bu değişiklikte değişmedi — değişen koda bağlı, etkilenen kod.'}
        </p>
      </header>

      {decl?.signature && (
        <Section id="insp.signature" title="İmza">
          <code className="sig">{decl.signature}</code>
        </Section>
      )}

      <Section id="insp.relations" title="Değişen kodla bağı" resizable resizeLabel="Bağlantılar bölümü yüksekliği" extra={totalLinks > 0 ? <span className="gauge prop-tree__count">{totalLinks}</span> : undefined}>
        {anchor && (
          <p className="srel__anchor">
            Etkileyen değişiklik: <SymbolLink id={anchor} label={symbolLabel(index, anchor)} status={changedStatus(index, anchor)} />
          </p>
        )}
        <LinkList title="Çağırdığı değişen semboller" items={rel.calls} />
        <LinkList title="Override ettiği değişen metot" items={rel.overrides} />
        <LinkList title="Değişen üst tipler" items={rel.supers} />
        <LinkList title="Bu gövdeden değişen koda giden çağrılar" items={outgoing} />
        {totalLinks === 0 && !anchor && (
          <p className="muted">
            {outline.isPending && !outline.isError ? 'Bağlantılar yükleniyor…' : `Bilinen doğrudan bağ yok${tab.symbolId ? ` (${shortId(tab.symbolId)})` : ''}.`}
          </p>
        )}
      </Section>

      {subjectId && <NoteEditor noteKey={symbolNoteKey(subjectId)} label="Sembol notu" />}
    </div>
  );
}
