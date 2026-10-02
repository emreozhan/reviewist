import { Icon } from '../../components/Icon';
import { Segmented } from '../../components/Segmented';
import type { NavMode } from '../../state/uiStore';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FindingsNavList } from './FindingsNavList';
import { GroupList } from './GroupList';
import { LayerTree } from './LayerTree';
import { NavFilters } from './NavFilters';
import { PlanList } from './PlanList';

export function Navigator({ onCollapse }: { onCollapse: () => void }) {
  const { index } = useReviewCtx();
  const counts = index.findingCounts.total;
  const mode = useUi((s) => s.navMode);
  const setMode = useUi((s) => s.setNavMode);

  return (
    <div className="nav">
      <div className="panel-head">
        <span className="panel-head__title">Gezgin</span>
        <button type="button" className="icon-btn icon-btn--sm" onClick={onCollapse} aria-label="Gezgini daralt" title="Gezgini daralt">
          <Icon name="chevronLeft" />
        </button>
      </div>
      <div className="nav__modes">
        <Segmented<NavMode>
          ariaLabel="Gezgin modu"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'plan', label: 'Okuma planı', title: 'Önerilen okuma sırası' },
            { value: 'layers', label: 'Katman', title: 'Katman → paket → dosya' },
            { value: 'groups', label: 'Gruplar', title: 'Birbirine bağlı değişiklik kümeleri', badge: index.groupsByRisk.length },
            { value: 'findings', label: 'Bulgular', title: 'Hata ve uyarılar', badge: counts.error + counts.warning },
          ]}
        />
      </div>
      {mode !== 'findings' && <NavFilters mode={mode} />}
      {/* Mod başına ayrı kaydırma kabı: başka modun kaydırma konumu taşınmaz. */}
      <div className="nav__body" key={mode}>
        {mode === 'plan' && <PlanList />}
        {mode === 'layers' && <LayerTree />}
        {mode === 'groups' && <GroupList />}
        {mode === 'findings' && <FindingsNavList />}
      </div>
    </div>
  );
}
