import type { SidePanel } from '../lib/panelSizes';
import { useLayout } from '../state/layoutStore';
import { Icon } from './Icon';

const NAME: Record<SidePanel, string> = { nav: 'Gezgini', insp: 'Denetçiyi' };

/** Yan panel başlığındaki düğmeler: genişlet/önceki boyut ve daralt. */
export function PanelTools({ panel }: { panel: SidePanel }) {
  const wide = useLayout((s) => s.wide === panel);
  const toggleWide = useLayout((s) => s.toggleWide);
  const setCollapsed = useLayout((s) => s.setCollapsed);
  const name = NAME[panel];
  return (
    <span className="panel-tools">
      <button
        type="button"
        className={`icon-btn icon-btn--sm${wide ? ' is-on' : ''}`}
        onClick={() => toggleWide(panel)}
        aria-pressed={wide}
        aria-label={wide ? `${name} önceki boyutuna döndür` : `${name} genişlet`}
        title={wide ? 'Önceki boyuta dön' : 'Genişlet'}
      >
        <Icon name={wide ? 'shrink' : 'grow'} />
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--sm"
        onClick={() => setCollapsed(panel, true)}
        aria-label={`${name} daralt`}
        title="Daralt"
      >
        <Icon name={panel === 'nav' ? 'chevronLeft' : 'chevronRight'} />
      </button>
    </span>
  );
}
