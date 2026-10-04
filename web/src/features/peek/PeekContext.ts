import { createContext } from 'react';
import type { PeekFrom } from '../../lib/peekStack';

/**
 * Bağlantının bulunduğu yer: gözatma penceresinin içindeyse o pencerenin seviyesi (yeni pencere onun üstüne açılır),
 * orta paneldeki kodda 'new' (yeni zincir), başka yerlerde (denetçi, etki haritası) 'top' (yığının en üstüne).
 */
export const PeekFromContext = createContext<PeekFrom>('top');
