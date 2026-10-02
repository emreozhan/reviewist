import { useTheme } from '../state/theme';
import { Icon } from './Icon';

const LABEL = { system: 'Tema: sistem', dark: 'Tema: koyu', light: 'Tema: açık' } as const;
const ICON = { system: 'auto', dark: 'moon', light: 'sun' } as const;

export function ThemeToggle() {
  const pref = useTheme((s) => s.pref);
  const cycle = useTheme((s) => s.cycle);
  return (
    <button type="button" className="icon-btn" onClick={cycle} title={`${LABEL[pref]} (değiştirmek için tıklayın)`} aria-label={`${LABEL[pref]}. Değiştir`}>
      <Icon name={ICON[pref]} />
    </button>
  );
}
