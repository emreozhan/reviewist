import type { MemberChange, TypeChange } from '../../../src/shared/types';

interface PropagationBadgesProps {
  member?: MemberChange;
  type?: TypeChange;
}

/** "↗ 3 çağıran (1 diff dışı)", "⇣ 3 alt sınıfta override" gibi yayılım göstergeleri. */
export function PropagationBadges({ member, type }: PropagationBadgesProps) {
  const items: { key: string; glyph: string; text: string; outside: boolean; title: string }[] = [];
  if (member) {
    const outside = member.callers.filter((c) => !c.inChangedCode).length;
    if (member.callers.length > 0) {
      items.push({
        key: 'callers',
        glyph: '↗',
        text: `${member.callers.length} çağıran${outside > 0 ? ` (${outside} diff dışı)` : ''}`,
        outside: outside > 0,
        title: 'Bu sembolü çağıran yerler',
      });
    }
    if (member.overriddenBy.length > 0) {
      items.push({ key: 'ovby', glyph: '⇣', text: `${member.overriddenBy.length} alt sınıfta override`, outside: false, title: 'Alt tiplerde bu metodu override edenler' });
    }
    if (member.overrides.length > 0) {
      items.push({ key: 'ov', glyph: '⇡', text: 'üst metodu override eder', outside: false, title: member.overrides.join(', ') });
    }
  }
  if (type && type.subTypes.length > 0) {
    items.push({ key: 'sub', glyph: '⇣', text: `${type.subTypes.length} alt tip`, outside: false, title: 'Doğrudan alt tipler / implementasyonlar' });
  }
  if (items.length === 0) return null;
  return (
    <span className="prop">
      {items.map((i) => (
        <span key={i.key} className={`prop__badge${i.outside ? ' prop__badge--outside' : ''}`} title={i.title}>
          <span aria-hidden="true">{i.glyph}</span> {i.text}
        </span>
      ))}
    </span>
  );
}
