export { getJavaParser } from './parser.js';
export { parseJavaFile } from './extract.js';
export { diffJavaFile, detectCrossFileMoves, memberSimilarity } from './semanticDiff.js';
export type { DiffFileOptions } from './semanticDiff.js';
export { RepoIndex } from './repoIndex.js';
export { isTestPath, sourceRootOf } from './names.js';
export {
  clearParseCache,
  closeParsePool,
  configureParseCache,
  defaultParseConcurrency,
  parseCacheStats,
  parseJavaFiles,
  parsePoolStats,
} from './parsePool.js';
export type { ParseItem, ParseOptions } from './parsePool.js';
export { NULL_TYPE, argCompatibility, inferArgType, typeCompat, typeVarsOf } from './typeInference.js';
export type { Compat, TypeCtx as ArgTypeCtx } from './typeInference.js';
export type * from './model.js';
