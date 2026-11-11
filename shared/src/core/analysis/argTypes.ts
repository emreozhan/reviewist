/**
 * Çağrı argümanlarının statik tip çıkarımı ve parametre tipiyle uyumluluk.
 * Tek uygulama java şeridindeki `src/core/java/typeInference.ts`'tedir (overload bağlama ile ortak); burası analiz
 * modülleri için yönlendirmedir.
 */
export { argCompatibility, inferArgType, NULL_TYPE, typeVarsOf } from '../java/typeInference.js';
export type { Compat, TypeCtx } from '../java/typeInference.js';
