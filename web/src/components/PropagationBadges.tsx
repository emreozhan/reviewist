import type { MemberChange, TypeChange } from '../../../src/shared/types';
import { useReviewCtx } from '../features/workspace/ReviewContext';
import { callerCounts } from '../lib/propagation';

interface PropagationBadgesProps {
  member?: MemberChange;
  type?: TypeChange;
}

/** "↗ 3 çağıran (1 diff dışı)", "⇣ 3 alt sınıfta override" gibi yayılım göstergeleri. */
export function PropagationBadges({ member, type }: PropagationBadgesProps) {
  const { index } = useReviewCtx();
  const items: { key: string; glyph: string; text: string; outside: boolean; title: string; tone?: string }[] = [];
  if (member) {
    const c = callerCounts(member.callers, (file) => index.fileById.has(file));
    if (c.verified > 0) {
      items.push({
        key: 'callers',
        glyph: '↗',
        text: `${c.verified} çağıran${c.outside > 0 ? ` (${c.outside} diff dışı)` : ''}${c.likely > 0 ? ` · ${c.likely} olası` : ''}`,
        outside: c.outside > 0,
        title: c.likely > 0
          ? `Bu sembolü çağıran yerler. ${c.likely} tanesi "olası": alıcı tipi kesin çözülemedi, overload/arity ile eşlendi.`
          : 'Bu sembolü çağıran yerler (alıcı tipi çözüldü)',
        tone: c.likely > 0 ? 'likely' : undefined,
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
        <span key={i.key} className={`prop__badge${i.outside ? ' prop__badge--outside' : ''}${i.tone ? ` prop__badge--${i.tone}` : ''}`} title={i.title}>
          <span aria-hidden="true">{i.glyph}</span> {i.text}
        </span>
      ))}
    </span>
  );
}
