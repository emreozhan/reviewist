import { UnreachableDialog } from './components/UnreachableDialog';
import { ReviewScreen } from './features/workspace/ReviewScreen';
import { SourcePage } from './features/source/SourcePage';
import { useHashRoute } from './hooks/useHashRoute';

export function App() {
  const route = useHashRoute();
  return (
    <>
      {route.name === 'home' ? (
        <SourcePage />
      ) : (
        <ReviewScreen key={route.id} id={route.id} tab={route.tab} params={route.params} />
      )}
      <UnreachableDialog />
    </>
  );
}
