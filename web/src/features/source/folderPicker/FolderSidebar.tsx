import type { FsRoot } from '../../../../../src/shared/types';
import { Icon } from '../../../components/Icon';
import type { IconName } from '../../../components/Icon';
import { baseName, samePath } from '../../../lib/fsPath';

interface FolderSidebarProps {
  roots: FsRoot[];
  recent: string[];
  current?: string;
  onGo: (path: string) => void;
  /** Son kullanılan repo: üst klasörüne gidilir, repo seçili gelir. */
  onRecent: (path: string) => void;
}

const ROOT_ICON: Record<FsRoot['kind'], IconName> = { home: 'home', special: 'folder', cwd: 'terminal', drive: 'drive' };

/** Sol kısayollar: ev/özel klasörler/sürücüler ve son kullanılan repolar. */
export function FolderSidebar({ roots, recent, current, onGo, onRecent }: FolderSidebarProps) {
  const isHere = (p: string) => current !== undefined && samePath(p, current);
  return (
    <nav className="fp-side" aria-label="Kısayollar">
      <h3 className="fp-side__title">Konumlar</h3>
      <ul className="fp-side__list">
        {roots.map((r) => (
          <li key={`${r.kind}:${r.path}`}>
            <button type="button" className={`fp-side__item${isHere(r.path) ? ' is-here' : ''}`} onClick={() => onGo(r.path)} title={r.path} aria-current={isHere(r.path) ? 'location' : undefined}>
              <Icon name={ROOT_ICON[r.kind]} />
              <span className="fp-side__label">{r.label}</span>
            </button>
          </li>
        ))}
        {roots.length === 0 && <li className="fp-side__empty">Yükleniyor…</li>}
      </ul>
      <h3 className="fp-side__title">Son kullanılan repolar</h3>
      {recent.length === 0 ? (
        <p className="fp-side__empty">Başarılı analizlerin repoları burada listelenir.</p>
      ) : (
        <ul className="fp-side__list">
          {recent.map((p) => (
            <li key={p}>
              <button type="button" className="fp-side__item fp-side__item--repo" onClick={() => onRecent(p)} title={p}>
                <Icon name="clock" />
                <span className="fp-side__label">{baseName(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
