import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, WheelEvent } from 'react';
import type { MenuAction } from '../../components/ActionMenu';
import { ActionMenu } from '../../components/ActionMenu';
import { Icon } from '../../components/Icon';
import { useCodeNav } from '../../hooks/useCodeNav';
import { useTabCommands } from '../../hooks/useTabCommands';
import { symbolLabel } from '../../lib/reviewIndex';
import type { EditorTab } from '../../lib/tabs';
import { useLayout } from '../../state/layoutStore';
import { useProgress } from '../../state/progressStore';
import { useTabs } from '../../state/tabsStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { TabItem } from './TabItem';

type MenuState = { kind: 'all'; x: number; y: number } | { kind: 'ctx'; key: string; x: number; y: number };

/**
 * IDE tarzı sekme çubuğu (role=tablist): ← → ile gezinme, Delete kapatma, sürükle-bırak sıralama,
 * taşmada yatay kaydırma + açık sekmeler menüsü, bağlam menüsü (kapat / diğerlerini kapat / sabitle).
 */
export function TabBar() {
  const { index } = useReviewCtx();
  const tabs = useTabs((s) => s.tabs);
  const activeKey = useTabs((s) => s.activeKey);
  const seen = useProgress((s) => s.seen);
  const focusMode = useLayout((s) => s.focusMode);
  const toggleFocus = useLayout((s) => s.toggleFocusMode);
  const nav = useCodeNav();
  const cmd = useTabCommands();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [overflow, setOverflow] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Taşma ölçümü ve etkin sekmeyi görünür tutma.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);
  useEffect(() => {
    // scrollIntoView üst kapları da kaydırabilir; yalnız sekme listesi yatayda kaydırılır.
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement;
    if (!list || !el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [activeKey, tabs.length]);

  const onActivate = useCallback((tab: EditorTab) => nav.activateTab(tab), [nav]);
  const onPin = useCallback((key: string) => useTabs.getState().pin(key), []);
  const onClose = cmd.close;
  const onContext = useCallback((key: string, x: number, y: number) => setMenu({ kind: 'ctx', key, x, y }), []);
  const onDragStart = useCallback(() => setDropKey(null), []);
  const onDragOver = useCallback((key: string) => setDropKey(key), []);
  const onDrop = useCallback((from: string, to: string) => {
    useTabs.getState().move(from, to);
    setDropKey(null);
  }, []);
  const onDragEnd = useCallback(() => setDropKey(null), []);

  const onKeyNav = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
      const st = useTabs.getState();
      const i = st.tabs.findIndex((t) => t.key === key);
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % st.tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + st.tabs.length) % st.tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = st.tabs.length - 1;
      else if (e.key === 'Delete') {
        e.preventDefault();
        cmd.close(key);
        return;
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setMenu({ kind: 'ctx', key, x: r.left, y: r.bottom });
        return;
      }
      // Alt'lı oklar gezinme geçmişine ayrılmıştır.
      if (j < 0 || e.altKey) return;
      e.preventDefault();
      const tab = st.tabs[j];
      if (!tab) return;
      nav.activateTab(tab);
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[role="tab"][aria-selected="true"]`)?.focus());
    },
    [cmd, nav],
  );

  // Dikey tekerlek de yatay kaydırsın (taşan sekmeler).
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = listRef.current;
    if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
  };

  const menuActions = (): MenuAction[] => {
    if (!menu) return [];
    if (menu.kind === 'all') {
      const list: MenuAction[] = tabs.map((t) => ({
        key: t.key,
        label: (
          <>
            {t.inDiff ? '' : '◌ '}
            {t.label}
            {t.preview ? <em className="amenu__preview"> (önizleme)</em> : null}
          </>
        ),
        hint: t.path.slice(t.path.lastIndexOf('/') + 1),
        current: t.key === activeKey,
        onSelect: () => nav.activateTab(t),
      }));
      if (activeKey) list.push({ key: '__others', label: 'Diğerlerini kapat', separated: true, disabled: tabs.length < 2, onSelect: () => cmd.closeOthers(activeKey) });
      list.push({ key: '__all', label: 'Tüm sekmeleri kapat', separated: !activeKey, disabled: tabs.length === 0, onSelect: cmd.closeAll });
      return list;
    }
    const tab = tabs.find((t) => t.key === menu.key);
    if (!tab) return [];
    return [
      { key: 'close', label: 'Kapat', hint: 'Alt+W', onSelect: () => cmd.close(tab.key) },
      { key: 'others', label: 'Diğerlerini kapat', disabled: tabs.length < 2, onSelect: () => cmd.closeOthers(tab.key) },
      { key: 'pin', label: 'Sekmeyi sabitle', disabled: !tab.preview, onSelect: () => useTabs.getState().pin(tab.key) },
    ];
  };

  return (
    <div className="tabbar">
      <div className="tabbar__list" role="tablist" aria-label="Açık dosyalar" ref={listRef} onWheel={onWheel}>
        {tabs.length === 0 && <span className="tabbar__empty">Açık sekme yok</span>}
        {tabs.map((t, i) => (
          <TabItem
            key={t.key}
            tab={t}
            index={i}
            active={t.key === activeKey}
            seen={t.inDiff && !!seen[t.path]}
            fileStatus={t.inDiff ? index.fileById.get(t.path)?.status : undefined}
            symbolText={t.symbolId ? symbolLabel(index, t.symbolId) : undefined}
            dropTarget={dropKey === t.key}
            onActivate={onActivate}
            onPin={onPin}
            onClose={onClose}
            onContext={onContext}
            onKeyNav={onKeyNav}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
      <div className="tabbar__tools">
        <button
          type="button"
          className={`icon-btn icon-btn--sm${overflow ? ' has-overflow' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === 'all'}
          aria-label={`Açık sekmeler (${tabs.length})`}
          title={`Açık sekmeler (${tabs.length})`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu((m) => (m?.kind === 'all' ? null : { kind: 'all', x: r.right - 260, y: r.bottom + 4 }));
          }}
        >
          <Icon name="tabs" />
          {overflow && <span className="tabbar__count">{tabs.length}</span>}
        </button>
        <button
          type="button"
          className={`icon-btn icon-btn--sm${focusMode ? ' is-on' : ''}`}
          aria-pressed={focusMode}
          aria-label={focusMode ? 'Odak modundan çık' : 'Odak modu: yan panelleri gizle'}
          title={focusMode ? 'Odak modundan çık (Esc / f)' : 'Odak modu (f): yan panelleri gizle'}
          onClick={toggleFocus}
        >
          <Icon name="focus" />
        </button>
      </div>
      {menu && <ActionMenu label={menu.kind === 'all' ? 'Açık sekmeler' : 'Sekme işlemleri'} actions={menuActions()} at={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
    </div>
  );
}
