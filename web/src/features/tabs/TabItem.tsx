import { memo } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import type { FileStatus } from '../../../../src/shared/types';
import { FILE_STATUS_META } from '../../lib/labels';
import type { EditorTab } from '../../lib/tabs';
import { altLabel } from '../../lib/platform';

export const TAB_DRAG_TYPE = 'application/x-reviewist-tab';

export function tabDomId(i: number): string {
  return `etab-${i}`;
}

interface TabItemProps {
  tab: EditorTab;
  index: number;
  active: boolean;
  seen: boolean;
  fileStatus?: FileStatus;
  /** Odaklanılan sembolün kısa adı (ipucunda). */
  symbolText?: string;
  dropTarget: boolean;
  onActivate: (tab: EditorTab) => void;
  onPin: (key: string) => void;
  onClose: (key: string) => void;
  onContext: (key: string, x: number, y: number) => void;
  onKeyNav: (e: KeyboardEvent<HTMLButtonElement>, key: string) => void;
  onDragStart: (key: string) => void;
  onDragOver: (key: string) => void;
  onDrop: (from: string, to: string) => void;
  onDragEnd: () => void;
}

function StatusMark({ tab, seen, fileStatus }: { tab: EditorTab; seen: boolean; fileStatus?: FileStatus }) {
  if (!tab.inDiff) {
    const old = tab.side === 'old';
    return (
      <span className={`etab__st etab__st--out${old ? ' etab__st--old' : ''}`} title={old ? 'Silinmiş — eski sürüm' : 'Diff dışı — değişmedi'}>
        <span aria-hidden="true">{old ? '−' : '◌'}</span>
        <span className="sr-only">{old ? 'silinmiş, eski sürüm' : 'diff dışı, değişmedi'}</span>
      </span>
    );
  }
  const meta = fileStatus ? FILE_STATUS_META[fileStatus] : undefined;
  return (
    <span className={`etab__st status--${meta?.status ?? 'modified'}`} title={`${meta?.label ?? 'Değişen dosya'}${seen ? ' · görüldü' : ''}`}>
      <span aria-hidden="true">{meta?.glyph ?? 'M'}</span>
      {seen && (
        <span className="etab__seen" aria-hidden="true">
          ✓
        </span>
      )}
      <span className="sr-only">
        {meta?.label ?? 'değişen dosya'}
        {seen ? ', görüldü' : ''}
      </span>
    </span>
  );
}

/** Sekme: durum ikonu + sınıf adı; önizleme sekmesi italik. Orta tık kapatır, çift tık sabitler, sürüklenerek sıralanır. */
export const TabItem = memo(function TabItem(p: TabItemProps) {
  const { tab, index, active } = p;
  const title = `${tab.path}${tab.symbolId && p.symbolText ? `\nOdak: ${p.symbolText}` : ''}${tab.preview ? '\nÖnizleme sekmesi (çift tık: sabitle)' : ''}`;
  const onAux = (e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    p.onClose(tab.key);
  };
  return (
    <div
      className={`etab${active ? ' is-active' : ''}${tab.preview ? ' is-preview' : ''}${tab.inDiff ? '' : ' is-outside'}${p.seen ? ' is-seen' : ''}${p.dropTarget ? ' is-drop' : ''}`}
      role="presentation"
      draggable
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(TAB_DRAG_TYPE, tab.key);
        e.dataTransfer.effectAllowed = 'move';
        p.onDragStart(tab.key);
      }}
      onDragOver={(e: DragEvent) => {
        if (!e.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        p.onDragOver(tab.key);
      }}
      onDrop={(e: DragEvent) => {
        const from = e.dataTransfer.getData(TAB_DRAG_TYPE);
        if (!from) return;
        e.preventDefault();
        p.onDrop(from, tab.key);
      }}
      onDragEnd={p.onDragEnd}
    >
      <button
        type="button"
        role="tab"
        id={tabDomId(index)}
        aria-selected={active}
        aria-controls="center-tabpanel"
        tabIndex={active ? 0 : -1}
        className="etab__btn"
        title={title}
        onClick={() => p.onActivate(tab)}
        onDoubleClick={() => p.onPin(tab.key)}
        onAuxClick={onAux}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onContext(tab.key, e.clientX, e.clientY);
        }}
        onKeyDown={(e) => p.onKeyNav(e, tab.key)}
      >
        <StatusMark tab={tab} seen={p.seen} fileStatus={p.fileStatus} />
        <span className="etab__label">{tab.label}</span>
        {tab.preview && <span className="sr-only"> (önizleme)</span>}
      </button>
      <button type="button" className="etab__close" tabIndex={-1} aria-label={`${tab.label} sekmesini kapat`} title={`Kapat (${altLabel}+W, orta tık)`} onClick={() => p.onClose(tab.key)}>
        ×
      </button>
    </div>
  );
});
