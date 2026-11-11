/// <reference types="vite/client" />

/**
 * Derleme sabiti (bkz. kök vite.config.ts `define`): arayüz hangi uygulama için derlendi.
 * Sürüme özel kod bununla doğrudan dallanır (`if (__EDITION__ === 'github')`) ki diğer sürümün kodu ölü kod olarak atılsın.
 */
declare const __EDITION__: 'local' | 'github';
