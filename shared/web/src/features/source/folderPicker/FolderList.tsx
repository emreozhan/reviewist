import { useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { Icon } from '../../../components/Icon';
import { VirtualList } from '../../../components/VirtualList';
import { typeAheadIndex } from '../../../lib/typeAhead';
import type { FolderBrowser, FolderRow } from './useFolderBrowser';

interface FolderListProps {
  id: string;
  browser: FolderBrowser;
  listRef: RefObject<HTMLDivElement | null>;
  /** Ctrl+Enter: seçili (yoksa gezilen) klasörü seç. */
  onConfirm: () => void;
}

const TYPE_AHEAD_RESET_MS = 700;
const PAGE = 10;
const rowKey = (r: FolderRow): string => r.key;
const rowHeight = (): number => 34;

/** Klasör listesi: `role="listbox"`, etkin satır `aria-activedescendant` ile; uzun listeler pencerelenir. */
export function FolderList({ id, browser, listRef, onConfirm }: FolderListProps) {
  const { rows, selectedIndex } = browser;
  const typed = useRef({ text: '', at: 0 });
  const optionId = (i: number) => `${id}-opt-${i}`;

  const move = (i: number) => {
    if (rows.length === 0) return;
    browser.selectIndex(Math.max(0, Math.min(rows.length - 1, i)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === 'ArrowDown') move(selectedIndex < 0 ? 0 : selectedIndex + 1);
    else if (k === 'ArrowUp') move(selectedIndex < 0 ? 0 : selectedIndex - 1);
    else if (k === 'Home') move(0);
    else if (k === 'End') move(rows.length - 1);
    else if (k === 'PageDown') move(selectedIndex + PAGE);
    else if (k === 'PageUp') move(selectedIndex - PAGE);
    else if (k === 'Enter' && (e.ctrlKey || e.metaKey)) onConfirm();
    else if (k === 'Enter') browser.open(browser.selectedRow);
    else if (k === 'Backspace') browser.goUp();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (k !== ' ' || typed.current.text !== '')) {
      const now = performance.now();
      const text = now - typed.current.at > TYPE_AHEAD_RESET_MS ? k : typed.current.text + k;
      typed.current = { text, at: now };
      const hit = typeAheadIndex(rows.map((r) => r.label), text, selectedIndex);
      if (hit >= 0) browser.selectIndex(hit);
    } else return;
    e.preventDefault();
  };

  return (
    <div
      ref={listRef}
      className="fp-list"
      role="listbox"
      tabIndex={0}
      aria-label="Klasörler"
      aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
      onKeyDown={onKeyDown}
    >
      <VirtualList
        items={rows}
        itemKey={rowKey}
        estimate={rowHeight}
        role="presentation"
        itemRole="presentation"
        activeKey={browser.selectedRow?.key ?? null}
        threshold={150}
        renderItem={(row, i) => (
          <div
            id={optionId(i)}
            role="option"
            aria-selected={i === selectedIndex}
            className={`fp-row${i === selectedIndex ? ' is-selected' : ''}${row.kind === 'dir' && row.entry.isGitRepo ? ' is-git' : ''}${row.kind === 'dir' && row.entry.hidden ? ' is-hidden' : ''}`}
            title={row.kind === 'up' ? `Üst klasör: ${row.path}` : row.path}
            onClick={() => {
              browser.selectIndex(i);
              listRef.current?.focus();
            }}
            onDoubleClick={() => browser.open(row)}
          >
            {row.kind === 'up' ? (
              <>
                <Icon name="arrowUp" className="fp-row__icon" />
                <span className="fp-row__name">..</span>
                <span className="fp-row__meta">üst klasör</span>
              </>
            ) : (
              <>
                <Icon name={row.entry.isGitRepo ? 'branch' : 'folder'} className="fp-row__icon" />
                <span className="fp-row__name">{row.label}</span>
                {row.entry.isGitRepo && <span className="fp-badge">git</span>}
              </>
            )}
          </div>
        )}
      />
    </div>
  );
}
