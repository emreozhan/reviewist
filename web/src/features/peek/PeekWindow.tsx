import { useCallback, useId, useMemo, useState } from 'react';
import type { CSSProperties, RefCallback } from 'react';
import { PropagationBadges } from '../../components/PropagationBadges';
import { Switch } from '../../components/Switch';
import { useOutline } from '../../hooks/queries';
import { useCodeNav } from '../../hooks/useCodeNav';
import type { PanelSize } from '../../lib/peekLayout';
import type { PeekEntry, PeekRect } from '../../lib/peekStack';
import { usePeek } from '../../state/peekStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { peekZ } from './PeekConnectors';
import { PeekFromContext } from './PeekContext';
import type { PeekFocus } from './PeekCode';
import { PeekFileDiff, PeekMemberDiff, PeekSource } from './PeekCode';
import { PeekHeader } from './PeekHeader';
import { peekMeta, STATUS_VAR } from './peekMeta';
import { usePeekGeometry } from './usePeekGeometry';

interface PeekWindowProps {
  entry: PeekEntry;
  level: number;
  depth: number;
  rect: PeekRect;
  panel: PanelSize;
  crumbs: PeekEntry[] | null;
  bodyRef: RefCallback<HTMLDivElement>;
}

/**
 * Tek gözatma penceresi (modal değil): başlık (sürüklenebilir), bilgi şeridi, kod gövdesi, boyutlandırma tutamacı.
 * Alttaki bir pencereye tıklamak onu öne almaz; üstündekileri kapatıp o seviyeye döner.
 */
export function PeekWindow({ entry, level, depth, rect, panel, crumbs, bodyRef }: PeekWindowProps) {
  const { review, index } = useReviewCtx();
  const nav = useCodeNav();
  const titleId = useId();
  const active = level === depth - 1;
  const { target, symbolId } = entry;
  const isJava = target.path.endsWith('.java');
  const outline = useOutline(review.id, target.path, target.side, isJava);
  const decl = outline.data?.decls.find((d) => d.id === symbolId);
  const meta = peekMeta(index, entry, decl);

  // Odak satırı: çağrı yerinde çağrı satırı; değilse bildirimin ad satırı (anotasyonların altı), yoksa bilinen satır.
  const line = target.callSite ? target.line : (decl?.nameLine ?? target.line);
  const focus = useMemo<PeekFocus | null>(() => (line ? { line, tick: line } : null), [line]);
  const range = decl?.range ?? (target.line && target.endLine && target.endLine >= target.line ? { startLine: target.line, endLine: target.endLine } : undefined);

  const file = target.inDiff ? index.fileById.get(target.path) : undefined;
  const member = index.memberById.get(symbolId);
  const type = index.typeById.get(symbolId);
  const memberView = !!file && !!member && member.status !== 'unchanged' && index.symbolFile.get(member.id) === file.path && (!!member.newRange || !!member.oldRange);
  const [full, setFull] = useState(!memberView);

  const store = usePeek;
  const commitRect = useCallback((r: PeekRect) => store.getState().setRect(entry.uid, r), [store, entry.uid]);
  const geo = usePeekGeometry(rect, panel, commitRect, entry.maximized);

  const close = () => (level === 0 ? store.getState().closeAll() : store.getState().returnTo(level - 1));
  const openTab = (background: boolean) => {
    if (!background) store.getState().closeAll();
    nav.openTarget(target, { background });
  };

  const style = {
    left: geo.rect.x,
    top: geo.rect.y,
    width: geo.rect.w,
    height: geo.rect.h,
    zIndex: peekZ(level),
    '--peek-st': STATUS_VAR[meta.status],
  } as CSSProperties;

  return (
    <section
      className={`peek peek--l${level % 4}${active ? ' is-active' : ' is-under'}${meta.changed ? ' is-changed' : ''}${entry.maximized ? ' is-max' : ''}${geo.dragging ? ' is-dragging' : ''}`}
      style={style}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      id={`peek-${entry.uid}`}
      data-peek-level={level}
      title={active ? undefined : 'Tıklayınca bu seviyeye dönülür (üstteki pencereler kapanır)'}
      onPointerDownCapture={() => {
        if (!active) store.getState().returnTo(level);
      }}
    >
      <header className="peek__head" {...geo.moveHandlers}>
        <PeekHeader
          entry={entry}
          level={level}
          active={active}
          meta={meta}
          crumbs={active ? crumbs : null}
          titleId={titleId}
          onOpenTab={openTab}
          onToggleMax={() => store.getState().toggleMaximized(entry.uid)}
          onClose={close}
          onReturn={(i) => store.getState().returnTo(i)}
          onCloseAll={() => store.getState().closeAll()}
        />
      </header>
      <PeekFromContext.Provider value={level}>
        {(member || type || memberView) && (
          <div className="peek__info">
            <PropagationBadges member={member} type={member ? undefined : type} />
            <span className="peek__spacer" />
            {memberView && <Switch size="sm" checked={full} onChange={setFull} label="Tam dosyayı göster" />}
          </div>
        )}
        <div className="peek__body" ref={bodyRef} tabIndex={-1} aria-label={`${meta.typeName}${meta.memberPart} kodu`}>
          {file ? (
            memberView && !full && member ? (
              <PeekMemberDiff file={file} member={member} focus={focus} />
            ) : (
              <PeekFileDiff file={file} focus={focus} />
            )
          ) : (
            <PeekSource path={target.path} side={target.side} focus={focus} range={range} symbolId={symbolId} />
          )}
        </div>
      </PeekFromContext.Provider>
      {file && line ? (
        // Hedef satırın kalıcı vurgusu (diff tablosu satırı yalnız kısa süre parlatır).
        <style>{`#peek-${entry.uid} tr.dl[data-new="${line}"] > td { background-color: var(--diff-focus); } #peek-${entry.uid} tr.dl[data-new="${line}"] > .dl__rail { box-shadow: inset 3px 0 0 var(--accent); }`}</style>
      ) : null}
      {!entry.maximized && <div className="peek__grip" aria-hidden="true" title="Boyutlandır" {...geo.resizeHandlers} />}
    </section>
  );
}
