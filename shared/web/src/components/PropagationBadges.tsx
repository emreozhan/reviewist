import { useState } from 'react';
import type { MemberChange, TypeChange } from '../../../src/shared/types';
import { useReviewCtx } from '../features/workspace/ReviewContext';
import { useSymbolOpener } from '../hooks/useSymbolOpener';
import { CONFIDENCE_LABEL } from '../lib/labels';
import { callerCounts } from '../lib/propagation';
import type { ReviewIndex } from '../lib/reviewIndex';
import { baseName, symbolLabel } from '../lib/reviewIndex';
import type { SymbolMenuItem } from './SymbolMenu';
import { SymbolMenu } from './SymbolMenu';

interface PropagationBadgesProps {
  member?: MemberChange;
  type?: TypeChange;
}

interface Target extends SymbolMenuItem {
  id: string;
  hint?: { file?: string; line?: number; callSite?: boolean };
}

interface Badge {
  key: string;
  glyph: string;
  text: string;
  outside: boolean;
  title: string;
  tone?: string;
  menuTitle: string;
  targets: Target[];
}

function symbolTarget(index: ReviewIndex, id: string, key: string): Target {
  const m = index.memberById.get(id);
  const status = m?.status ?? index.typeById.get(id)?.status ?? index.nodeById.get(id)?.status;
  const inDiff = index.symbolFile.has(id);
  return { key, id, label: symbolLabel(index, id), detail: m?.signature, status: inDiff ? status : 'impacted', note: inDiff ? undefined : 'diff dışı' };
}

/**
 * "↗ 3 çağıran (1 diff dışı)", "⇣ 3 alt sınıfta override" gibi yayılım göstergeleri.
 * Her gösterge bir menü açar; seçilen sembol gözatma penceresinde açılır (Shift+tık: sekmede, Ctrl+tık: arka plan sekmesi).
 */
export function PropagationBadges({ member, type }: PropagationBadgesProps) {
  const { index } = useReviewCtx();
  const openSymbol = useSymbolOpener();
  const [open, setOpen] = useState<{ key: string; x: number; y: number; el: HTMLElement } | null>(null);
  const items: Badge[] = [];
  if (member) {
    const c = callerCounts(member.callers, (file) => index.fileById.has(file));
    const callTarget = (cr: MemberChange['callers'][number], i: number): Target => ({
      ...symbolTarget(index, cr.fromId, `c${i}`),
      detail: `${baseName(cr.file)}:${cr.line}`,
      note: [index.fileById.has(cr.file) ? '' : 'diff dışı', cr.confidence !== 'exact' ? CONFIDENCE_LABEL[cr.confidence] : ''].filter(Boolean).join(' · ') || undefined,
      hint: { file: cr.file, line: cr.line, callSite: true },
    });
    if (c.verified > 0) {
      items.push({
        key: 'callers',
        glyph: '↗',
        text: `${c.verified} çağıran${c.outside > 0 ? ` (${c.outside} diff dışı)` : ''}${c.likely > 0 ? ` · ${c.likely} olası` : ''}`,
        outside: c.outside > 0,
        title: c.likely > 0
          ? `Bu sembolü çağıran yerler. ${c.likely} tanesi "olası": alıcı tipi kesin çözülemedi, overload/arity ile eşlendi. Tıklayın: listeden seçip pencerede açın.`
          : 'Bu sembolü çağıran yerler (alıcı tipi çözüldü). Tıklayın: listeden seçip pencerede açın.',
        tone: c.likely > 0 ? 'likely' : undefined,
        menuTitle: 'Çağıranlar',
        targets: member.callers.map((cr, i) => ({ cr, i })).filter(({ cr }) => cr.confidence !== 'name-only').map(({ cr, i }) => callTarget(cr, i)),
      });
    }
    if (c.unverified > 0) {
      items.push({
        key: 'unverified',
        glyph: '?',
        text: `+${c.unverified} doğrulanamamış`,
        outside: false,
        title: 'Yalnız ad eşleşmesi: alıcı tipi çözülemedi, büyük olasılıkla başka bir metot. Denetçide varsayılan olarak gizli.',
        tone: 'unverified',
        menuTitle: 'Doğrulanamamış eşleşmeler',
        targets: member.callers.map((cr, i) => ({ cr, i })).filter(({ cr }) => cr.confidence === 'name-only').map(({ cr, i }) => callTarget(cr, i)),
      });
    }
    if (member.overriddenBy.length > 0) {
      items.push({
        key: 'ovby',
        glyph: '⇣',
        text: `${member.overriddenBy.length} alt sınıfta override`,
        outside: false,
        title: 'Alt tiplerde bu metodu override edenler. Tıklayın: listeden seçip pencerede açın.',
        menuTitle: 'Override edenler',
        targets: member.overriddenBy.map((id, i) => symbolTarget(index, id, `o${i}`)),
      });
    }
    if (member.overrides.length > 0) {
      items.push({
        key: 'ov',
        glyph: '⇡',
        text: 'üst metodu override eder',
        outside: false,
        title: member.overrides.join(', '),
        menuTitle: 'Override ettiği üst metot',
        targets: member.overrides.map((id, i) => symbolTarget(index, id, `u${i}`)),
      });
    }
  }
  if (type && type.subTypes.length > 0) {
    items.push({
      key: 'sub',
      glyph: '⇣',
      text: `${type.subTypes.length} alt tip`,
      outside: false,
      title: 'Doğrudan alt tipler / implementasyonlar. Tıklayın: listeden seçip pencerede açın.',
      menuTitle: 'Alt tipler',
      targets: type.subTypes.map((id, i) => symbolTarget(index, id, `s${i}`)),
    });
  }
  if (items.length === 0) return null;
  const openBadge = open ? items.find((i) => i.key === open.key) : undefined;

  return (
    <span className="prop">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          className={`prop__badge${i.outside ? ' prop__badge--outside' : ''}${i.tone ? ` prop__badge--${i.tone}` : ''}`}
          title={i.title}
          aria-haspopup="menu"
          aria-expanded={open?.key === i.key}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const el = e.currentTarget;
            setOpen((o) => (o?.key === i.key ? null : { key: i.key, x: r.left, y: r.bottom + 4, el }));
          }}
        >
          <span aria-hidden="true">{i.glyph}</span> {i.text}
        </button>
      ))}
      {open && openBadge && (
        <SymbolMenu<Target>
          title={openBadge.menuTitle}
          items={openBadge.targets}
          at={{ x: open.x, y: open.y }}
          onClose={() => setOpen(null)}
          onPick={(t, _background, intent) => void openSymbol(t.id, intent, { hint: t.hint, origin: { x: open.x, y: open.y }, returnFocus: open.el })}
        />
      )}
    </span>
  );
}
