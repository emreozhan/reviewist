import { useReactFlow } from '@xyflow/react';
import { useEffect } from 'react';

export const FIT_OPTIONS = { padding: 0.12, minZoom: 0.25, maxZoom: 1.1 } as const;

/**
 * Grafı görünür alana sığdırır; `signature` değişince (filtre, alt graf) yeniden.
 * React Flow 12'nin `fitView`'i düğümler ölçülene kadar kuyrukta bekler; yerleşik `fitView` prop'u
 * yalnız ilk kurulumda çalıştığı için filtre değişimleri ayrıca tetiklenir.
 */
export function AutoFit({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void fitView(FIT_OPTIONS);
    });
    return () => cancelAnimationFrame(id);
  }, [signature, fitView]);
  return null;
}
